import type { NextConfig } from 'next';
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,agentRules:false,experimental:{cpus:1},
  async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'Cache-Control',value:'private, no-store'}]}];}};
export default config;
