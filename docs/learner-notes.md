# Aap ke liye module-wise zaroori baatein

Yeh seekhne ki Roman Urdu notes hain. Code aur technical evidence English files mein hain. Real service ka test tabhi pass samjhein jab evidence mein uska actual result likha ho.

## Module 0: naqsha

1. Pehle tables, unke rishte aur permission rules samjhein.
2. Role user ka global role nahi; team membership ka role hai.
3. Hina admin hai, lekin restricted file ke liye usay bhi explicit read grant chahiye.

Chhota kaam: Ali ko Leave Policy kyun milti hai aur Salary Plan kyun nahi? Apne alfaaz mein batayein.

## Module 1: database

1. API, worker aur migration ke database credentials alag hain.
2. Foreign keys galat team ke records ko jorne se rokti hain; RLS galat read se rokti hai.
3. Member remove ho kar dobara aaye to nayi membership banti hai; purane grants wapas nahi aate.

Chhota kaam: `npm run db:inspect` chala kar Sara ke HR aur Engineering roles dekhein.

## Module 2: login aur membership

1. Backend verified token se user ko pehchanta hai; browser ka bheja hua user ID acting identity nahi banta.
2. Har request par current team role dobara check hota hai.
3. Aakhri active admin ko remove ya demote nahi kar sakte.

Chhota kaam: Sara ko HR mein viewer banayein aur upload dobara try karein.

## Module 3: private files

1. Nayi file restricted hoti hai aur uploader ko read grant milta hai.
2. Role aur file ka read grant do alag cheezein hain.
3. File download backend ki permission check se hoti hai; public bucket link se nahi.

Chhota kaam: Sara file upload kare; Ali aur Hina ke accounts se access compare karein. Real Supabase setup pehle zaroori hai.

## Module 4: processing

1. `queued` file abhi AI ke liye ready nahi hoti.
2. Naya version fail ho to purana ready version chalna chahiye.
3. Duplicate ya purana worker deleted file ko wapas active nahi kar sakta.

Chhota kaam: document ke Versions mein ready aur failed status ka farq dekhein.

## Module 5: quota

1. `held` ka matlab slot reserve hai; `used` ka matlab successful saved grounded answer hai.
2. Retry mein wahi idempotency key dobara jati hai; duplicate charge nahi hona chahiye.
3. App ka quota aur AI provider ka paison wala bill alag hain.

Chhota kaam: dedicated test mein limit ko current used + 1 rakhein, taa-ke aik slot bache; do naye requests try karein, phir original limit restore karein. Used count pehle se ho to total limit 1 karna aik free slot nahi deta.

## Module 6: AI answer aur history

1. Model ko sirf woh current documents jate hain jo user parh sakta hai.
2. Model ko diye gaye tamam chunks record hote hain, chahe sab citations mein na dikhaye gaye hon.
3. Kisi bhi source ka access chala jaye to poora purana assistant answer hide hota hai.

Chhota kaam: grant revoke kar ke purani chat, citation aur feedback dobara kholein. Citation hona answer ki sachai ki guarantee nahi.

## Module 7: admin aur audit

1. Admin members, grants aur quota manage karta hai; doosre member ki private chat nahi parh sakta.
2. Audit mein action ka record hota hai; document ka matn ya secret key nahi.
3. Permission badalne wali action aur uska audit aik transaction mein save hote hain.

Chhota kaam: Hina se quota change karein aur audit mein uska record dekhein.

## Module 8: screens

1. Button ka nazar aana permission ka saboot nahi; backend final check karta hai.
2. Team change/logout par purana protected data clear hota hai.
3. `NEXT_PUBLIC_` mein sirf public settings; AI key, Storage secret aur database password kabhi nahi.

Chhota kaam: Sara se HR aur Engineering switch karein aur upload controls compare karein.

## Module 9: submission

1. `.env.example` template hai; real values root `.env` mein rehti hain. Template ko sambhal kar rakhein.
2. Source ZIP mein real `.env`, passwords, uploaded files ya database data nahi dena.
3. Fake AI/Storage ke test pass aur real services ke live test pass do alag results hain.

Chhota kaam: README, actual test evidence aur PDF report kholein. Supabase aur AI ki real values apni machine par privately configure karke live checklist poori karein.

## Live challenges: 2026-11-21

46/46 real-service challenge checks aur 72/72 automated checks pass hue. Salary Plan mein Hina ka explicit grant hai; Ali aur Sara ko default access nahi; Ahmed sirf Engineering admin hai, HR mein nahi aa sakta. Sara editor hone se Salary Plan ka access nahi milta.

Admin ka role aur file ka read grant alag hain. Hina ko Sara ki nayi private file khud-ba-khud nahi mili. Hina trusted HR admin hone ki wajah se audited action se apne liye grant bana sakti hai. Kisi admin ko doosre member ki private chat ka automatic access nahi.

Do alag sawal saath aaye aur quota tha to dono chale: do saved answers, do charges. Sirf aik slot bacha tha to aik answer bana aur doosre ko 429 mila. Database pehle slot reserve karta hai, phir successful answer ke saath charge karta hai. Wahi question/key do baar aaye to aik answer aur aik charge; dobara replay wahi message deta hai. Yeh app ke quota counts hain, provider ke paison ka bill nahi.

Sara ko Salary Plan ka grant diya to 120 invented training credits ka cited answer mila. Grant wapas liya to refreshed purani chat ka poora answer, source, download aur replay band hue. Pehle download ki hui file ya screenshot wapas nahi li ja sakti. Ab Salary Plan dobara sirf Hina ke grant par hai; roles pehle jaise hain, monthly limit 1000, test ke baad used 8 aur held 0 the.

Khud dekhne ke liye Hina ko normal window aur Sara ko Incognito mein login karein. Hina se Salary Plan ka grant dein, Sara se sawal karein, phir Hina se revoke karke Sara ki chat/source refresh karein. Do normal tabs aik hi login share kar sakte hain. Tamam test files invented hain. Exact checks `docs/live-challenges-run.json` aur English guide `docs/restriction-challenges.md` mein hain.

## Engineering aur viva ki tayari: 2026-11-23

Engineering mein Ahmed admin aur Sara viewer hai; editor abhi koi nahi. Engineering handbook actual upload/worker/AI pipeline se Ready hui aur Team-visible hai. 23/23 live checks pass hue. Sara parh/ask kar sakti hai; upload/Admin 403 deta hai. Ahmed ka Engineering admin hona HR access ya Sara ki private chat ka access nahi deta.

Mukammal learner guide `docs/learner-preparation.md` mein hai: 21 tables ke rishte, upload/question ka safar, ten lifecycle rules, quota race, manual exercises aur viva questions. `docs/requirements-review.md` English mein actual coverage aur baqi tests batati hai. `docs/engineering-practice.md` mein copyable English questions aur expected facts hain. Aap apne exercises aur decisions ke reasons apne lafzon mein likhein; AI-assisted generated material independent authorship ka proof nahi.
