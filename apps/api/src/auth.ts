import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Config } from './config';
import { uuid } from './config';
import type { Database } from './database';

export interface VerifiedIdentity { subject: string; label: string }
export interface TokenVerifier { verify(token: string): Promise<VerifiedIdentity> }

export class SupabaseTokenVerifier implements TokenVerifier {
  private jwks: any;
  constructor(private readonly cfg: Config) {}
  async verify(token: string): Promise<VerifiedIdentity> {
    if (!this.cfg.supabaseUrl || !this.cfg.issuer) throw new ServiceUnavailableException('Authentication is not configured');
    try {
      const jose = await import('jose');
      const header = jose.decodeProtectedHeader(token); // Chooses verification flow only; no identity trusted here.
      if (header.alg === 'HS256') {
        if (!this.cfg.publishableKey) throw new ServiceUnavailableException('Authentication is not configured');
        const response = await fetch(`${this.cfg.supabaseUrl}/auth/v1/user`, {
          headers: { apikey:this.cfg.publishableKey, Authorization:`Bearer ${token}` }, signal:AbortSignal.timeout(8000) });
        if (!response.ok) throw new UnauthorizedException();
        const user = await response.json() as any;
        // GoTrue has verified the signature; also enforce this API's expected claims.
        const claims=jose.decodeJwt(token);const now=Date.now()/1000;
        if(claims.sub!==user.id||claims.iss!==this.cfg.issuer||
          !(Array.isArray(claims.aud)?claims.aud.includes(this.cfg.audience):claims.aud===this.cfg.audience)||
          typeof claims.exp!=='number'||claims.exp<=now-5||typeof claims.iat!=='number'||claims.iat>now+5||
          (typeof claims.nbf==='number'&&claims.nbf>now+5))throw new UnauthorizedException();
        return { subject:uuid.parse(user.id),label:typeof user.user_metadata?.name==='string'?user.user_metadata.name:'Member' };
      }
      if (!['ES256','RS256'].includes(header.alg || '')) throw new UnauthorizedException();
      this.jwks ||= jose.createRemoteJWKSet(new URL(`${this.cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`), { timeoutDuration:8000 });
      const { payload } = await jose.jwtVerify(token,this.jwks,{ issuer:this.cfg.issuer,audience:this.cfg.audience,
        algorithms:['ES256','RS256'],requiredClaims:['sub','exp','iat'],clockTolerance:5 });
      if(typeof payload.iat!=='number'||payload.iat>Date.now()/1000+5)throw new UnauthorizedException();
      const metadata = payload.user_metadata as any;
      return { subject:uuid.parse(payload.sub),label:typeof metadata?.name==='string'?metadata.name:'Member' };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly verifier: TokenVerifier,private readonly db: Database) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.path === '/health') return true;
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length>16384) throw new UnauthorizedException('Access token required');
    const identity = await this.verifier.verify(header.slice(7));
    request.userId = await this.db.identity(identity.subject,identity.label);
    return true;
  }
}
