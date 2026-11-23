# Project samajhne aur explain karne ki tayari

Tayari ki tareekh: 2026-11-23, Asia/Karachi. Yeh learner ke liye Roman Urdu guide hai. Code, technical evidence aur design documents English mein hain.

Yeh implementation AI-assisted hai. Aapka asal kaam sirf ready-made jawab yaad karna nahi: rules samajhna, unka reason dena, alternatives sochna aur apni pasand ke decisions adopt ya revise karna hai. Neeche exercises ke results aap khud likhein; mere likhe hue explanations aapke independent kaam ka proof nahi hain.

## 1. Aik minute mein project ka maqsad

TechCo aik organization hai. HR aur Engineering uski do teams hain. Har team apne allowed documents par sawal poochti hai. Backend pehle login verify karta hai, phir current membership aur file access check karta hai. Sirf allowed document ke chunks AI ko milte hain. Answer ke saath source aata hai. Permission badalne par purana protected answer bhi dobara check hota hai. Background worker file ka text aur embeddings banata hai; quota saved grounded answers ginata hai.

Is explanation ko apne lafzon mein bol kar record karein. Sirf un checks ka claim karein jo aapne dekhe ya evidence mein verify kiye hain.

## 2. Kaun kis team mein kya hai?

| Shakhs | HR | Engineering |
| --- | --- | --- |
| Ali | Viewer | Member nahi |
| Sara | Editor | Viewer |
| Hina | Admin | Member nahi |
| Ahmed | Member nahi | Admin |

Engineering mein abhi editor koi nahi. Ahmed admin hone ki wajah se upload bhi kar sakta hai. Sara Engineering mein read/ask kar sakti hai; upload aur Admin nahi. Wahi Sara HR mein editor hai, isliye HR upload kar sakti hai. User par global role lagane ke bajaye har membership ka role rakha gaya hai.

Admin members, grants aur quota manage karta hai. Har restricted file ka automatic read aur doosre member ki private chat ka access nahi milta. Trusted same-team admin explicit audited action se khud ko file ka grant de sakta hai; yeh trust boundary samjhana zaroori hai.

Team-visible ka matlab sirf us team ke active members ka app access hai. Supabase Storage bucket phir bhi private rehti hai; file ka public Internet link nahi banta.

Sara ka password user ki request par reset karke sirf private `.tmp/demo-login-credentials.txt` mein save hua. Is machine par VS Code mein Ctrl+O dabayein aur yeh path kholein:

```text
C:\Users\DELL\OneDrive\Documents\secure-multi-team-ai-assistant\.tmp\demo-login-credentials.txt
```

Sara ka purana password use na karein. Password ko source package ya chat mein copy karne ki zaroorat nahi.

## 3. Har technology ka seedha maqsad

- Next.js: login, Chat, Documents aur Admin screens.
- NestJS: verified identity, current roles, upload, protected chat aur admin APIs.
- PostgreSQL: relationships, permissions, transactions, usage aur durable jobs ki canonical database.
- pgvector: chunks ke embeddings aur similarity search. Vector permission nahi deta.
- Supabase Auth: email/password login aur signed access token.
- Supabase private Storage: original PDF/TXT ke bytes. Local PostgreSQL ke tables dashboard ki Auth/Storage se alag hain.
- Redis/BullMQ: background kaam ka ticket deliver karte hain. Kaam ki durable sachai PostgreSQL mein hai.
- Worker: original download, text extraction, chunks, real Gemini embeddings aur ready activation/purge.
- Gemini: is setup mein embedding provider. Groq: answer provider. App quota aur provider free limits alag hain.

PostgreSQL kyun? Foreign keys ghalat relationships rokti hain; transactions related changes aik saath commit karti hain; row locks race ko serialize karte hain; RLS doosri layer ki boundary deta hai. Is relational problem mein yeh rules inspect aur test kiye ja sakte hain. PostgreSQL hi akela possible choice nahi, yeh is implementation ka reasoned working choice hai.

## 4. Har table ka maqsad aur rishta

| Table | Kaam aur rishta |
| --- | --- |
| organizations | TechCo ka record; iski teams hoti hain |
| teams | HR/Engineering; organization se linked; authorization changes ka locking gate |
| users | Verified Auth subject se app profile ka link; password/global role yahan nahi |
| memberships | User + team + role; Sara ke do alag records |
| documents | File ki protected identity/title/visibility aur current version pointer; team se linked |
| document_grants | Restricted document kis active membership ko parhne diya; grant/revoke history |
| storage_intents | Upload se pehle durable intention; storage success aur DB failure ke darmiyan cleanup ka record |
| document_versions | Aik document ki immutable revisions aur private original metadata |
| document_chunks | Version ka chhota text, original line/page location aur vector |
| embedding_profiles | Model, dimensions aur chunker ki compatible identity; ghalat vectors mix nahi hote |
| processing_jobs | Process/purge ka kaam, attempts, lease aur fence; target version/document se linked |
| outbox_events | Job ka Redis delivery intent; DB job ke saath same transaction |
| conversations | Team aur owner membership ki private chat |
| messages | Conversation ke user/assistant messages |
| message_sources | Answer ke liye AI ko diye gaye tamam chunks, cited aur uncited dono |
| feedback | Accessible own assistant answer ka helpful/unhelpful rating/comment |
| usage_budgets | Team ki monthly limit |
| usage_periods | Team + UTC month ka used/held counter |
| usage_reservations | Scoped request key aur reserved answer slot ka durable record |
| usage_attempts | Retry attempt/fence; expired worker ya response dobara settle nahi kar sakta |
| audit_logs | Safe actor/action record; runtime users ke liye append-only |

Yeh 21 business tables hain; migration metadata alag hai. Count yaad karne se zyada flow samjhein: organization -> team -> membership; document -> version -> chunk; conversation -> message -> sources.

Har team-scoped child reference mein team ID bhi verify hoti hai. Isliye HR ka grant Engineering membership ya source ko galti se reference nahi kar sakta. User ka diya hua team ID apne aap authority nahi hai.

## 5. Upload ka poora safar

1. Ahmed ka token verify hota hai aur Engineering admin membership milti hai.
2. Backend file type/size aur upload permission check karta hai.
3. PostgreSQL mein upload intent banta hai; private original Storage mein jata hai.
4. Finalization document/version, job aur outbox ko consistent transaction mein attach karti hai.
5. Redis job ID deliver karta hai. Worker SQL lease/fence ke saath job claim karta hai.
6. Worker original ke hash/size verify karke text aur location-aware chunks banata hai.
7. Gemini vectors deta hai. Valid dimensions/fence/profile ke saath complete transaction hoti hai.
8. Version ready/current hota hai. Failed replacement purani working version ko nahi mitata.

File list mein Not Uploaded ka matlab seed metadata hai, actual original abhi upload nahi hua. Queued/Processing ka matlab background kaam baqi hai. Ready ka matlab retrieval ke liye eligible processed version hai. Ready permission ko bypass nahi karta.

## 6. Sawal ka poora safar

1. Token ke signature, issuer, audience aur time claims verify hote hain.
2. Current database membership se user ka role/access resolve hota hai.
3. Database atomic quota slot hold karti hai.
4. Current-ready aur authorized chunks hi eligible hote hain; question vector se ranking hoti hai.
5. Model ko question aur eligible evidence milta hai; hidden files nahi di jatin.
6. Returned labels allowed source set se validate hote hain.
7. Final transaction tamam potential sources dobara check/lock karti hai.
8. Successful grounded answer, provenance aur quota charge saath commit hote hain. Failure/insufficient result ka hold release hota hai.

Browser par button hide karna akela security nahi. Sara ne Engineering upload endpoint directly call kiya to actual backend ne bhi 403 diya.

## 7. Dus rules jinka reason samjhana hai

| Rule | Seedha reason / tradeoff |
| --- | --- |
| Har membership ka alag role | Aik shakhs teams mein mukhtalif zimmedari rakh sakta hai |
| Upload default restricted | Nayi file ghair-iradi taur par poori team ko share na ho |
| Admin read grant alag | Administration aur private content read ko explicit rakha; trusted admin self-grant audit hota hai |
| Immutable versions | Old citation kis exact original se aayi, dobara verify ho sake |
| Highest successfully ready revision wins | Slow old job nayi ready file ko replace na kare; failed update last good version ko bachaye |
| Delete pehle tombstone, phir purge | API read foran band ho; remote deletion service outage mein bhi retry ho sake |
| Direct team move nahi | Existing grants/history ko chupke doosri team mein na le jaye; permitted re-upload nayi identity/grants leta hai |
| Rejoin par nayi membership | Purane grants/private chats automatically revive na hon |
| All supplied sources ki provenance | Uncited private paragraph se bhi answer influence ho sakta hai |
| Whole affected historical answer hide | Sirf citation hatane se answer ke andar private fact reh sakta hai |

Yeh working rules design-decisions.md mein proposed/adoption status ke saath hain. Aapko har rule ke liye apna reason aur aik alternative likhna hai. Implementation ki authorization har proposal ki automatic adoption nahi.

## 8. Do sawal aik saath kaise handle hote hain?

`used` successful saved grounded answers hain; `held` in-flight reserved slots. Limit 1000 ho to admission par database used + held ko transaction lock ke andar check karti hai.

Do free slots hon: do requests reserve, dono successful hon to do used. Aik slot bacha ho: aik request reserve karti hai; doosri ko 429 milta hai. Winner transaction ordering se decide hota hai. Failed answer hold release karta hai.

Wahi request key aur wahi fingerprint dobara aaye to completed result reuse hota hai; in-progress duplicate ko 409 mil sakta hai. Wahi key lekin badla question conflict hai. Do same-looking questions ko alag keys se bhejna automatically aik request nahi banata.

Fence ka matlab attempt number/token hai. Purana expired attempt late answer la kar naye attempt ka slot charge nahi kar sakta. Vendor ka bill alag cheez hai; ledger test provider billing/call count measure nahi karta.

## 9. Existing hard-case proof ko kaise explain karein?

- Do uploads: real PostgreSQL/API test passed; Storage/AI controlled the. Live two-parallel-provider upload extension abhi baqi hai.
- Chat ke darmiyan delete/revoke: controlled model barrier par request pause hui; real SQL change commit hua; final gate ne save/delivery reject ki aur hold release hua. Dono operation orders test hue.
- Last quota slot: actual live do asks mein 201 + 429 mila; aik save/charge hua.
- Cross-team: Ali Engineering original nahi khol saka; Ahmed HR nahi aa saka; Engineering admin Sara ki private chat nahi parh saka.
- Prompt injection: controlled source-context spy aur fabricated label rejection passed. Broad real malicious-source model evaluation baqi hai; immunity ka claim nahi.
- Revoked history: Salary Plan grant wapas lene ke baad purana poora answer, citation, download, feedback aur replay protected hue. Pehle liya hua screenshot/download wapas nahi liya ja sakta.

Real-PG test ka AI adapter controlled hone se database race fake nahi ho jati. Us se model truthfulness ka live proof bhi nahi milta. Dono boundaries sahi batana tayari ka hissa hai.

## 10. Khud karne wale exercises

1. Bina guide dekhe org -> teams -> memberships aur document -> versions -> chunks draw karein. Sara ke do membership records banayein.
2. Ahmed se Engineering Documents kholein. Ready handbook aur upload/Admin dekhein. Sara se wohi team khol kar read/ask aur missing upload/Admin compare karein.
3. Sara ko HR par switch karein aur explain karein ke upload kyun wapas aaya. Do ordinary browser tabs ke bajaye isolated sessions use karein.
4. Engineering mein poochein: "According to the TechCo Engineering Handbook, how many minutes does the on-call engineer have to acknowledge a critical incident? Cite the source." Expected: 15 minutes aur supporting source.
5. Poochein: "How many approvals from another engineer are required before merging a pull request? Cite the source." Expected: at least one. Source khud khol kar line dekhein.
6. Apne accessible answer ko Helpful rate karein; Ahmed se safe audit/usage inspect karein. Doosre member ki chat kholne ki permission assume na karein.
7. Hina se Salary Plan question poochein: "According to the Salary Plan, how many training credits are allocated for the next review cycle? Cite the source." Expected: 120. Ali/Sara without grant ko protected fact na mile.
8. Hina Sara ko temporary Salary Plan grant de; Sara answer/source dekhe; Hina revoke kare. Sara old chat/citation refresh kare. Test ke baad temporary grant wapas hata dein.
9. Write five design choices in your own words: chosen rule, reason, rejected alternative, tradeoff, test evidence. Jo choice pasand nahi, usay proposed revision likhein.
10. Report ke passed/pending rows dekh kar teen examples batayein: real provider check, real SQL plus controlled provider check, aur unexecuted live fault check.

Queue/database ko jaan-boojh kar band karne wale fault tests ya budget change shared demo par casually na karein. Unka dedicated fixture/cleanup plan requirements-review.md mein hai. Reviewer ke saamne sirf apne kiye exercises ko apna executed work kahein.

## 11. Viva ke sawal aur jawab ki direction

| English question | Jawab ka main point |
| --- | --- |
| Why PostgreSQL? | Relationships, constraints, transactions, row locks, RLS aur same database mein pgvector |
| Authentication versus authorization? | Token se identity; current membership/grants se permission |
| Why is the role not stored on users? | Sara HR editor aur Engineering viewer aik saath hai |
| Can a viewer call a hidden upload endpoint? | Call kar sakta hai; backend 403 se reject karta hai |
| Why not send every chunk to the LLM and ask it to hide private facts? | SQL mein eligible sources pehle select hote hain; hidden content model input ka hissa nahi banta |
| Why store uncited sources? | Answer unse influence ho sakta hai; access loss par complete answer protect karna hai |
| What if a document is deleted during generation? | Final locked source gate ordering decide karti hai; delete wins to delivery/save/charge reject |
| What if an old worker finishes after a newer version? | Fence aur monotone current-version activation old completion ko naya current nahi banne dete |
| What if storage succeeds but finalization fails? | Durable storage intent cleanup/purge ko discover aur retry karwata hai |
| What if Redis loses a ticket? | SQL job/outbox durable hain; redispatch se recovery design hoti hai; live crash test abhi alag pending |
| What happens when a member leaves and rejoins? | Old membership terminal; new ID; old grants/chats automatic return nahi |
| Why can an admin not read every chat? | Private conversation ownership explicit boundary hai; admin management role uska override nahi |
| Does a citation guarantee truth? | Allowed source identity validate hoti hai; semantic grounding ko alag evaluate karna hota hai |
| What does idempotency protect? | Same request/fingerprint ke retries ko duplicate save/application charge se bachata hai |
| Is the monthly quota the AI provider bill? | Nahi; aik app accounting unit hai, vendor limits/cost alag hain |
| What remains before real production use? | Real-service faults/load/restore/model evaluation, hardened deployment, monitoring, secret operations, malware isolation aur retention |

Answers ko lafz-ba-lafz yaad na karein. Har jawab mein TechCo ka aik example aur actual evidence/limit bolne ki practice karein.

## 12. Services aur submission

Abhi services chal rahi hon to duplicate start commands na chalayein. Computer restart ke baad, project directory se database aur Redis ready karein; API, worker aur frontend teen alag terminals/processes hain:

```powershell
npm run db:native:start
docker compose up -d redis
```

Phir alag terminals:

```powershell
npm run api:start
```

```powershell
npm run worker:start
```

```powershell
npm run web:start
```

Supabase project active aur private local keys valid honi chahiye. Sirf dashboard tab kholna local services ko start nahi karta.

Source ZIP, three-page PDF aur diagrams/schema + diagrams/architecture ke PNG/SVG/Mermaid kholein. Private .env, password file, actual Storage originals, dependencies aur runtime data package mein nahi jane chahiye. GitHub upload is current task mein shamil nahi ki gayi.
