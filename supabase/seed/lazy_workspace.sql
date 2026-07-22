-- ============================================================================
-- Aster: Lazy Sdn Bhd workspace seed  (expanded)
-- ============================================================================
-- Seeds a rich, consistent sample workspace (jobs, candidates, applications,
-- interviews, scorecards) for the "Lazy Sdn Bhd" company ONLY. It first
-- wipes that company's existing workspace rows, so it is safe to re-run and
-- leaves no orphaned interviews behind. Run it in the Supabase SQL editor (it
-- executes as table owner, bypassing RLS on purpose). No other company is
-- touched.
--
-- Coverage: 8 jobs (open / closed / draft) x 20 candidates, with applications
-- across EVERY pipeline stage: applied, shortlisted, interviewing, offer,
-- hired, declined, rejected. Fit is set so the Strong / Other tabs are
-- meaningful, and a few roles carry interviews + scorecards.

do $$
declare
  co        record;
  owner_id  uuid;
  found_co  boolean := false;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; j6 uuid; j7 uuid; j8 uuid;
  -- Publishing respects the plan's CONCURRENT open-role cap (0071: launch 1,
  -- scale 5, elite 10, enterprise unlimited). Roles are inserted as drafts
  -- (always free) and published below only up to that cap.
  v_limit int; v_open int := 0; v_job uuid;
  owner_name text; owner_email text;
  panel_id uuid;      -- a real panel member (not the poll creator) to cast votes
  panel_n  int := 0;  -- how many interviewers got assigned to each role
  p1 uuid; p2 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a9 uuid; a10 uuid;
  a11 uuid; a12 uuid; a13 uuid; a14 uuid; a15 uuid; a16 uuid; a17 uuid; a18 uuid; a19 uuid; a20 uuid;
begin
for co in
  select id from public.companies c
  where c.id = '7aa5103a-3e9b-4c6c-b306-032bc6a513e8'  -- Lazy Sdn Bhd (tenant@onlazy.com)
loop
  -- Prefer the owner as author/interviewer; fall back to any profile.
  select id, coalesce(full_name, 'Hiring Manager'), coalesce(email, 'hiring@onlazy.com')
    into owner_id, owner_name, owner_email
    from public.profiles
    where company_id = co.id order by (role = 'owner') desc, created_at limit 1;

  -- ---------- wipe existing workspace (clean re-seed) ----------
  -- Deleting candidates cascades to applications, interviews, scorecards and
  -- offers; deleting jobs cascades to job_views and role assignments.
  delete from public.candidates where company_id = co.id;
  delete from public.jobs where company_id = co.id;
  -- activity_log.candidate_id / job_id are plain uuids (no FK), so these rows do
  -- NOT cascade with the deletes above and would pile up on every re-run.
  delete from public.activity_log where company_id = co.id;
  found_co := true;

  -- ---------- jobs ----------
  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Senior Frontend Engineer (React)', 'draft', owner_id, jsonb_build_object(
    'department','Engineering','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','senior','salary_min',9000,'salary_max',13000,'salary_currency','MYR',
    'description','Lead our design system and component architecture, working closely with design and product.',
    'responsibilities', jsonb_build_array('Own and evolve the design system','Lead frontend architecture','Partner with designers on Figma-to-code','Mentor mid-level engineers','Champion accessibility and performance'),
    'requirements', jsonb_build_array('5+ years production React with TypeScript','Experience scaling a design system','Strong accessible, responsive CSS','Pixel-accurate Figma-to-UI','Clear code-review habits'),
    'skills', jsonb_build_array('React','TypeScript','CSS','Design Systems'),
    'benefits', jsonb_build_array('Health insurance','Flexible hours','Learning budget','Hybrid KL office','MacBook Pro')))
  returning id into j1;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'WordPress Developer', 'draft', owner_id, jsonb_build_object(
    'department','Engineering','location','Petaling Jaya','employment_type','full_time',
    'remote_type','onsite','seniority_level','mid','salary_min',4500,'salary_max',7000,'salary_currency','MYR',
    'description','Build and maintain client websites on WordPress across PHP themes, plugins and custom builds.',
    'responsibilities', jsonb_build_array('Build and maintain WordPress sites','Develop custom themes and plugins','Set up WooCommerce stores','Handle performance, security, backups','Deliver pixel-accurate pages'),
    'requirements', jsonb_build_array('3+ years WordPress development','Solid PHP, HTML, CSS, JS','WooCommerce and page builders','Hosting, DNS, site security','Manage multiple client projects'),
    'skills', jsonb_build_array('WordPress','PHP','WooCommerce','MySQL'),
    'benefits', jsonb_build_array('EPF & SOCSO','Medical coverage','Parking allowance','Team lunches','Clear career path')))
  returning id into j2;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Product Designer (UI/UX)', 'draft', owner_id, jsonb_build_object(
    'department','Design','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','remote','seniority_level','mid','salary_min',6000,'salary_max',9500,'salary_currency','MYR',
    'description','Own end-to-end product design for our core hiring product, from research to polished UI.',
    'responsibilities', jsonb_build_array('Run discovery and usability research','Design flows, wireframes and hi-fi UI','Maintain the design system in Figma','Partner closely with engineering','Present work to stakeholders'),
    'requirements', jsonb_build_array('4+ years product design','Strong Figma and prototyping','Portfolio of shipped product work','Comfort with research and testing','Systems thinking'),
    'skills', jsonb_build_array('Figma','Prototyping','User Research','Design Systems'),
    'benefits', jsonb_build_array('Fully remote','Health insurance','Design conference budget','Latest hardware','Flexible hours')))
  returning id into j3;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Talent Acquisition Specialist', 'closed', owner_id, jsonb_build_object(
    'department','People','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','mid','salary_min',5000,'salary_max',8000,'salary_currency','MYR',
    'description','Drive full-cycle recruiting across engineering and design roles.',
    'responsibilities', jsonb_build_array('Own full-cycle recruiting','Source across channels','Run structured interviews','Improve time-to-hire','Own candidate experience'),
    'requirements', jsonb_build_array('3+ years in-house recruiting','Tech hiring experience','Structured interviewing','ATS fluency','Great communication'),
    'skills', jsonb_build_array('Sourcing','Interviewing','ATS'),
    'benefits', jsonb_build_array('Health insurance','Hybrid work','Referral bonuses','Learning budget','Wellness allowance')))
  returning id into j4;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Backend Engineer (Node.js)', 'draft', owner_id, jsonb_build_object(
    'department','Engineering','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','senior','salary_min',9500,'salary_max',14000,'salary_currency','MYR',
    'description','Design and scale the APIs and data models behind our hiring platform.',
    'responsibilities', jsonb_build_array('Design and build REST APIs','Model and tune PostgreSQL schemas','Own service reliability and observability','Write pragmatic tests','Review backend architecture'),
    'requirements', jsonb_build_array('5+ years backend with Node.js','Strong PostgreSQL and SQL','API design and versioning','Cloud deployment experience','Comfort with on-call basics'),
    'skills', jsonb_build_array('Node.js','PostgreSQL','TypeScript','AWS'),
    'benefits', jsonb_build_array('Health insurance','Hybrid work','Learning budget','MacBook Pro','Annual bonus')))
  returning id into j5;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'QA Engineer', 'draft', owner_id, jsonb_build_object(
    'department','Engineering','location','Petaling Jaya','employment_type','full_time',
    'remote_type','hybrid','seniority_level','mid','salary_min',5500,'salary_max',8500,'salary_currency','MYR',
    'description','Own product quality end to end, from manual exploratory testing to automated regression suites.',
    'responsibilities', jsonb_build_array('Write and maintain automated E2E tests','Run exploratory and regression testing','Triage and reproduce bugs','Own release sign-off','Improve QA process'),
    'requirements', jsonb_build_array('3+ years QA experience','Automation with Playwright or Cypress','Strong bug reporting','API testing','Attention to detail'),
    'skills', jsonb_build_array('Playwright','Cypress','Manual Testing','API Testing'),
    'benefits', jsonb_build_array('Health insurance','Hybrid work','Learning budget','Flexible hours')))
  returning id into j6;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Digital Marketing Executive', 'draft', owner_id, jsonb_build_object(
    'department','Marketing','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','junior','salary_min',3800,'salary_max',5500,'salary_currency','MYR',
    'description','Grow our brand across search, social and email, and turn traffic into signups.',
    'responsibilities', jsonb_build_array('Run paid and organic campaigns','Own SEO content calendar','Manage social channels','Report on funnel metrics','Coordinate with design on assets'),
    'requirements', jsonb_build_array('1+ years digital marketing','Hands-on Google Ads and Meta Ads','SEO fundamentals','Analytics and reporting','Strong written English'),
    'skills', jsonb_build_array('SEO','Google Ads','Content Marketing','Analytics'),
    'benefits', jsonb_build_array('Health insurance','Hybrid work','Phone allowance','Team offsites')))
  returning id into j7;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Mobile Engineer (React Native)', 'draft', owner_id, jsonb_build_object(
    'department','Engineering','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','remote','seniority_level','mid','salary_min',8000,'salary_max',12000,'salary_currency','MYR',
    'description','Build and ship our iOS and Android apps from one React Native codebase.',
    'responsibilities', jsonb_build_array('Build cross-platform features','Own App Store and Play releases','Optimise app performance','Integrate push notifications','Work with design on native patterns'),
    'requirements', jsonb_build_array('3+ years React Native','Shipped apps to both stores','Native build tooling familiarity','TypeScript','Debugging on real devices'),
    'skills', jsonb_build_array('React Native','TypeScript','Expo','Mobile'),
    'benefits', jsonb_build_array('Fully remote','Health insurance','Latest devices','Learning budget')))
  returning id into j8;

  -- ---------- publish roles, up to the plan's open-role cap ----------
  -- Every job above was inserted as a draft, which never takes a slot. Flip the
  -- roles we want live to 'open' one at a time, stopping at the plan limit, so
  -- the seed adapts to the workspace's plan instead of aborting with
  -- "open role limit reached" (0071). j4 stays closed, j8 stays a draft.
  v_limit := coalesce(public._job_post_limit((select plan from public.companies where id = co.id)), 9999);
  v_open := 0;
  foreach v_job in array array[j1, j2, j3, j5, j6, j7] loop
    exit when v_open >= v_limit;
    update public.jobs set status = 'open' where id = v_job;
    v_open := v_open + 1;
  end loop;
  raise notice 'Published % of 6 roles (plan cap %)', v_open, v_limit;

  -- ---------- interviewer panels (job_assignments) ----------
  -- A poll's panel is derived from job_assignments MINUS the poll's creator. With
  -- no rows here every poll reports "waiting on 0 interviewers to vote" and can
  -- never complete, because there is literally nobody who can vote. Assign every
  -- active teammate (except the owner, who creates the polls) to each role.
  -- Cascades off jobs, so the wipe above clears these automatically.
  insert into public.job_assignments (job_id, profile_id, company_id, assigned_by)
  select j.id, p.id, co.id, owner_id
  from public.jobs j
  cross join public.profiles p
  where j.company_id = co.id
    and p.company_id = co.id
    and p.status = 'active'
    and p.id <> owner_id
  on conflict (job_id, profile_id) do nothing;

  -- Pick one panel member to cast the poll votes below. Votes from the creator
  -- do not count (they're filtered out of the panel), which is why the seeded
  -- poll previously showed 0 votes even though rows existed.
  select p.id into panel_id
    from public.profiles p
    where p.company_id = co.id and p.status = 'active' and p.id <> owner_id
    order by p.created_at limit 1;
  select count(*) into panel_n
    from public.profiles p
    where p.company_id = co.id and p.status = 'active' and p.id <> owner_id;
  raise notice 'Assigned % interviewer(s) to each role', panel_n;

  -- ---------- candidates (parsed resumes) ----------
  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Amira Hassan','amira.hassan@email.com','+60 12-345 6789','Kuala Lumpur, Malaysia','Senior frontend engineer focused on design systems and component architecture.',6,
    '["React","TypeScript","Tailwind","GraphQL","Node.js","Figma"]','amira_hassan_resume.pdf','parsed',true,
    jsonb_build_object('name','Amira Hassan','email','amira.hassan@email.com','phone','+60 12-345 6789','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example','portfolio_url','https://amirahassan.dev','summary','Senior frontend engineer focused on design systems and component architecture, with a track record of shipping performant, accessible UI at scale.','years_of_experience',6,'salary_expectation','RM 9,500 - 11,000 / month','skills',jsonb_build_array('React','TypeScript','Tailwind','GraphQL','Node.js','Figma'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('AWS Certified Cloud Practitioner'),'experience',jsonb_build_array(jsonb_build_object('title','Senior Frontend Engineer','company','Grabtech','industry','Ride-hailing','duration','2021-Present','summary','Led design system rebuild, cut bundle size 40%.'),jsonb_build_object('title','Frontend Developer','company','Fave','industry','Fintech','duration','2018-2021','summary','Built checkout flows serving 2M+ MAU.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','Universiti Malaya','year','2018')))
  ) returning id into a1;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Daniel Teoh','daniel.teoh@email.com','+60 16-234 5678','Penang, Malaysia',null,4,
    '["Vue","JavaScript","CSS","WordPress","PHP"]','daniel_teoh_cv.pdf','parsed',false,
    jsonb_build_object('name','Daniel Teoh','email','daniel.teoh@email.com','phone','+60 16-234 5678','location','Penang, Malaysia','summary',null,'years_of_experience',4,'skills',jsonb_build_array('Vue','JavaScript','CSS','WordPress','PHP'),'languages',jsonb_build_array('English','Mandarin','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Web Developer','company','Freelance','industry','Digital Agency','duration','2020-Present','summary','Built 30+ SME sites for local Malaysian businesses.')),'education',jsonb_build_array(jsonb_build_object('degree','Diploma in IT','institution','TAR UC','year','2019')))
  ) returning id into a2;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Siti Rahman','siti.rahman@email.com','+60 19-876 5432','Cyberjaya, Malaysia','Creative frontend engineer blending 3D web experiences with production React.',3,
    '["React","Next.js","TypeScript","Three.js","GSAP","WebGL"]','siti_rahman_resume.pdf','parsed',true,
    jsonb_build_object('name','Siti Rahman','email','siti.rahman@email.com','phone','+60 19-876 5432','location','Cyberjaya, Malaysia','linkedin_url','https://linkedin.com/in/example2','portfolio_url','https://sitirahman.design','summary','Creative frontend engineer blending 3D web experiences with production-grade React.','years_of_experience',3,'skills',jsonb_build_array('React','Next.js','TypeScript','Three.js','GSAP','WebGL'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('Meta Front-End Developer Professional Certificate'),'experience',jsonb_build_array(jsonb_build_object('title','Creative Frontend Engineer','company','Studio Kite','industry','Digital Agency','duration','2022-Present','summary','Built award-nominated 3D portfolio sites for agency clients.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Design','institution','The One Academy','year','2021')))
  ) returning id into a3;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Marcus Lim','marcus.lim@email.com','+60 12-987 6543','Kuala Lumpur, Malaysia','Full-stack engineer with a frontend lean and strong TypeScript fundamentals.',5,
    '["React","Node.js","PostgreSQL","AWS","TypeScript"]','marcus_lim_resume.pdf','parsed',true,
    jsonb_build_object('name','Marcus Lim','email','marcus.lim@email.com','phone','+60 12-987 6543','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example3','summary','Full-stack engineer with a frontend lean, strong TypeScript, and cloud experience.','years_of_experience',5,'skills',jsonb_build_array('React','Node.js','PostgreSQL','AWS','TypeScript'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array('AWS Solutions Architect Associate'),'experience',jsonb_build_array(jsonb_build_object('title','Full-Stack Engineer','company','iPrice Group','industry','E-commerce','duration','2020-Present','summary','Owned pricing dashboards used across SEA.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Software Engineering','institution','APU','year','2019')))
  ) returning id into a4;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Nurul Aisyah','nurul.aisyah@email.com','+60 17-333 2211','Shah Alam, Malaysia','Frontend developer passionate about accessible, inclusive interfaces.',2,
    '["React","JavaScript","CSS","Accessibility"]','nurul_aisyah_cv.pdf','parsed',true,
    jsonb_build_object('name','Nurul Aisyah','email','nurul.aisyah@email.com','phone','+60 17-333 2211','location','Shah Alam, Malaysia','summary','Frontend developer passionate about accessible, inclusive interfaces.','years_of_experience',2,'skills',jsonb_build_array('React','JavaScript','CSS','Accessibility'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Frontend Developer','company','MoneyLion','industry','Fintech','duration','2022-Present','summary','Shipped accessible onboarding flows.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','UiTM','year','2022')))
  ) returning id into a5;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Kevin Wong','kevin.wong@email.com','+60 18-444 5566','Johor Bahru, Malaysia','WordPress and PHP developer with WooCommerce depth.',6,
    '["WordPress","PHP","WooCommerce","MySQL","JavaScript"]','kevin_wong_resume.pdf','parsed',false,
    jsonb_build_object('name','Kevin Wong','email','kevin.wong@email.com','phone','+60 18-444 5566','location','Johor Bahru, Malaysia','summary','WordPress and PHP developer with deep WooCommerce and hosting experience.','years_of_experience',6,'skills',jsonb_build_array('WordPress','PHP','WooCommerce','MySQL','JavaScript'),'languages',jsonb_build_array('English','Mandarin','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Senior WordPress Developer','company','Exabytes','industry','Web Hosting','duration','2018-Present','summary','Maintained 100+ client stores.')),'education',jsonb_build_array(jsonb_build_object('degree','Diploma in Computing','institution','Southern University College','year','2017')))
  ) returning id into a6;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Priya Nair','priya.nair@email.com','+60 11-222 3344','Kuala Lumpur, Malaysia','Product designer focused on research-led, systemised UI.',5,
    '["Figma","Prototyping","User Research","Design Systems"]','priya_nair_portfolio.pdf','parsed',true,
    jsonb_build_object('name','Priya Nair','email','priya.nair@email.com','phone','+60 11-222 3344','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example4','portfolio_url','https://priyanair.design','summary','Product designer focused on research-led, systemised UI and measurable outcomes.','years_of_experience',5,'skills',jsonb_build_array('Figma','Prototyping','User Research','Design Systems'),'languages',jsonb_build_array('English','Tamil','Malay'),'certifications',jsonb_build_array('NN/g UX Certification'),'experience',jsonb_build_array(jsonb_build_object('title','Product Designer','company','StashAway','industry','Fintech','duration','2021-Present','summary','Led redesign that lifted activation 18%.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Des Communication Design','institution','Dasein Academy','year','2018')))
  ) returning id into a7;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Farah Adya','farah.adya@email.com','+60 13-555 7788','Kuala Lumpur, Malaysia','Talent acquisition specialist with strong tech-hiring track record.',4,
    '["Sourcing","Interviewing","ATS","Employer Branding"]','farah_adya_resume.pdf','parsed',true,
    jsonb_build_object('name','Farah Adya','email','farah.adya@email.com','phone','+60 13-555 7788','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example5','summary','Talent acquisition specialist with a strong track record hiring engineers and designers.','years_of_experience',4,'skills',jsonb_build_array('Sourcing','Interviewing','ATS','Employer Branding'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Talent Acquisition Specialist','company','Setel','industry','Fintech','duration','2021-Present','summary','Cut time-to-hire from 42 to 26 days.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Human Resource Management','institution','Universiti Malaya','year','2019')))
  ) returning id into a8;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Hafiz Ibrahim','hafiz.ibrahim@email.com','+60 12-778 9911','Kuala Lumpur, Malaysia','Backend engineer specialising in Node.js APIs and PostgreSQL performance.',7,
    '["Node.js","PostgreSQL","TypeScript","AWS","Redis"]','hafiz_ibrahim_resume.pdf','parsed',true,
    jsonb_build_object('name','Hafiz Ibrahim','email','hafiz.ibrahim@email.com','phone','+60 12-778 9911','location','Kuala Lumpur, Malaysia','summary','Backend engineer specialising in Node.js APIs, PostgreSQL performance and cloud infrastructure.','years_of_experience',7,'skills',jsonb_build_array('Node.js','PostgreSQL','TypeScript','AWS','Redis'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('AWS Solutions Architect Professional'),'experience',jsonb_build_array(jsonb_build_object('title','Senior Backend Engineer','company','Carsome','industry','E-commerce','duration','2020-Present','summary','Scaled listing APIs to 5k rps.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','UTM','year','2017')))
  ) returning id into a9;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Chloe Tan','chloe.tan@email.com','+60 16-889 4477','Petaling Jaya, Malaysia','QA engineer with strong Playwright automation and release ownership.',5,
    '["Playwright","Cypress","API Testing","Manual Testing","CI/CD"]','chloe_tan_resume.pdf','parsed',true,
    jsonb_build_object('name','Chloe Tan','email','chloe.tan@email.com','phone','+60 16-889 4477','location','Petaling Jaya, Malaysia','summary','QA engineer with strong automation coverage and a habit of owning release sign-off.','years_of_experience',5,'skills',jsonb_build_array('Playwright','Cypress','API Testing','Manual Testing','CI/CD'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array('ISTQB Foundation'),'experience',jsonb_build_array(jsonb_build_object('title','QA Engineer','company','Aerodyne','industry','Drone Technology','duration','2021-Present','summary','Built E2E suite that cut regressions 60%.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Information Technology','institution','Monash Malaysia','year','2019')))
  ) returning id into a10;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Rajesh Kumar','rajesh.kumar@email.com','+60 17-661 2200','Kuala Lumpur, Malaysia','Backend developer with Node.js and distributed systems experience.',4,
    '["Node.js","MongoDB","Docker","Kubernetes","TypeScript"]','rajesh_kumar_cv.pdf','parsed',false,
    jsonb_build_object('name','Rajesh Kumar','email','rajesh.kumar@email.com','phone','+60 17-661 2200','location','Kuala Lumpur, Malaysia','summary','Backend developer comfortable across Node.js services, containers and queues.','years_of_experience',4,'skills',jsonb_build_array('Node.js','MongoDB','Docker','Kubernetes','TypeScript'),'languages',jsonb_build_array('English','Tamil','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Backend Developer','company','Fusionex','industry','Software Development','duration','2021-Present','summary','Built ingestion pipelines for analytics products.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Eng Software','institution','Multimedia University','year','2020')))
  ) returning id into a11;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Aisha Latif','aisha.latif@email.com','+60 13-909 8822','Shah Alam, Malaysia','Detail-driven QA analyst moving into automation.',3,
    '["Manual Testing","Cypress","Jira","SQL"]','aisha_latif_resume.pdf','parsed',true,
    jsonb_build_object('name','Aisha Latif','email','aisha.latif@email.com','phone','+60 13-909 8822','location','Shah Alam, Malaysia','summary','Detail-driven QA analyst building out automation skills alongside deep manual coverage.','years_of_experience',3,'skills',jsonb_build_array('Manual Testing','Cypress','Jira','SQL'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('ISTQB Foundation'),'experience',jsonb_build_array(jsonb_build_object('title','QA Analyst','company','Maybank','industry','Banking','duration','2022-Present','summary','Owned UAT for internal banking tools.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','UiTM','year','2021')))
  ) returning id into a12;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Bryan Lee','bryan.lee@email.com','+60 18-234 7788','Kuala Lumpur, Malaysia','React Native engineer who has shipped to both app stores.',5,
    '["React Native","TypeScript","Expo","iOS","Android"]','bryan_lee_resume.pdf','parsed',true,
    jsonb_build_object('name','Bryan Lee','email','bryan.lee@email.com','phone','+60 18-234 7788','location','Kuala Lumpur, Malaysia','summary','React Native engineer who has shipped and maintained apps on both the App Store and Play Store.','years_of_experience',5,'skills',jsonb_build_array('React Native','TypeScript','Expo','iOS','Android'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Mobile Engineer','company','Touch n Go Digital','industry','Fintech','duration','2020-Present','summary','Owned release pipeline for a 5M+ download app.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','Sunway University','year','2019')))
  ) returning id into a13;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Nadia Zulkifli','nadia.zulkifli@email.com','+60 19-445 1122','Kuala Lumpur, Malaysia','Digital marketer with paid social and SEO experience.',2,
    '["SEO","Google Ads","Meta Ads","Content Marketing"]','nadia_zulkifli_cv.pdf','parsed',true,
    jsonb_build_object('name','Nadia Zulkifli','email','nadia.zulkifli@email.com','phone','+60 19-445 1122','location','Kuala Lumpur, Malaysia','summary','Digital marketer running paid social and SEO content for consumer brands.','years_of_experience',2,'skills',jsonb_build_array('SEO','Google Ads','Meta Ads','Content Marketing'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('Google Ads Search Certification'),'experience',jsonb_build_array(jsonb_build_object('title','Marketing Executive','company','Zalora','industry','E-commerce','duration','2023-Present','summary','Grew organic traffic 45% in a year.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Mass Communication','institution','Taylor''s University','year','2022')))
  ) returning id into a14;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Ong Wei Jie','weijie.ong@email.com','+60 12-556 3399','Penang, Malaysia','Frontend engineer with strong React and testing discipline.',4,
    '["React","TypeScript","Jest","Tailwind"]','ong_weijie_resume.pdf','parsed',false,
    jsonb_build_object('name','Ong Wei Jie','email','weijie.ong@email.com','phone','+60 12-556 3399','location','Penang, Malaysia','summary','Frontend engineer with strong React fundamentals and a testing-first habit.','years_of_experience',4,'skills',jsonb_build_array('React','TypeScript','Jest','Tailwind'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Frontend Engineer','company','Intel Malaysia','industry','Semiconductors','duration','2021-Present','summary','Built internal tooling dashboards.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Eng Computer','institution','USM','year','2020')))
  ) returning id into a15;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Sofia Ahmad','sofia.ahmad@email.com','+60 11-778 2244','Kuala Lumpur, Malaysia','Product designer with a strong visual craft and motion sense.',3,
    '["Figma","Motion Design","Prototyping","Webflow"]','sofia_ahmad_portfolio.pdf','parsed',true,
    jsonb_build_object('name','Sofia Ahmad','email','sofia.ahmad@email.com','phone','+60 11-778 2244','location','Kuala Lumpur, Malaysia','portfolio_url','https://sofiaahmad.design','summary','Product designer with strong visual craft, motion sense and a growing research practice.','years_of_experience',3,'skills',jsonb_build_array('Figma','Motion Design','Prototyping','Webflow'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Product Designer','company','Wise Malaysia','industry','Fintech','duration','2022-Present','summary','Designed onboarding for a new market launch.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Graphic Design','institution','LimKokWing','year','2021')))
  ) returning id into a16;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Arun Pillai','arun.pillai@email.com','+60 17-220 6688','Ipoh, Malaysia','PHP developer with agency WordPress delivery experience.',4,
    '["WordPress","PHP","Elementor","MySQL"]','arun_pillai_cv.pdf','parsed',false,
    jsonb_build_object('name','Arun Pillai','email','arun.pillai@email.com','phone','+60 17-220 6688','location','Ipoh, Malaysia','summary','PHP developer delivering WordPress builds for agency clients on tight timelines.','years_of_experience',4,'skills',jsonb_build_array('WordPress','PHP','Elementor','MySQL'),'languages',jsonb_build_array('English','Tamil','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Web Developer','company','Vault Media','industry','Digital Agency','duration','2021-Present','summary','Delivered 40+ client sites.')),'education',jsonb_build_array(jsonb_build_object('degree','Diploma in Multimedia','institution','TAR UMT','year','2020')))
  ) returning id into a17;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Melissa Chong','melissa.chong@email.com','+60 16-303 9911','Kuala Lumpur, Malaysia','Growth marketer with lifecycle email and analytics strength.',5,
    '["Lifecycle Marketing","Analytics","SEO","Copywriting"]','melissa_chong_resume.pdf','parsed',true,
    jsonb_build_object('name','Melissa Chong','email','melissa.chong@email.com','phone','+60 16-303 9911','location','Kuala Lumpur, Malaysia','summary','Growth marketer strong on lifecycle email, funnel analytics and conversion copy.','years_of_experience',5,'skills',jsonb_build_array('Lifecycle Marketing','Analytics','SEO','Copywriting'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array('Google Analytics 4 Certification'),'experience',jsonb_build_array(jsonb_build_object('title','Growth Marketer','company','Grab','industry','Ride-hailing','duration','2020-Present','summary','Owned lifecycle campaigns across SEA markets.')),'education',jsonb_build_array(jsonb_build_object('degree','B.B.A. Marketing','institution','HELP University','year','2019')))
  ) returning id into a18;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Zainal Abidin','zainal.abidin@email.com','+60 13-118 4455','Melaka, Malaysia','QA lead with test strategy and team mentoring experience.',8,
    '["Test Strategy","Selenium","Playwright","Leadership"]','zainal_abidin_resume.pdf','parsed',false,
    jsonb_build_object('name','Zainal Abidin','email','zainal.abidin@email.com','phone','+60 13-118 4455','location','Melaka, Malaysia','summary','QA lead who builds test strategy and mentors junior testers.','years_of_experience',8,'skills',jsonb_build_array('Test Strategy','Selenium','Playwright','Leadership'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('ISTQB Advanced'),'experience',jsonb_build_array(jsonb_build_object('title','QA Lead','company','Celcom','industry','Telecommunications','duration','2018-Present','summary','Led a team of six testers across billing systems.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','UPM','year','2016')))
  ) returning id into a19;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Grace Lim','grace.lim@email.com','+60 12-664 7733','Kuala Lumpur, Malaysia','Mobile engineer across React Native and native Android.',6,
    '["React Native","Kotlin","TypeScript","Firebase"]','grace_lim_resume.pdf','parsed',true,
    jsonb_build_object('name','Grace Lim','email','grace.lim@email.com','phone','+60 12-664 7733','location','Kuala Lumpur, Malaysia','summary','Mobile engineer comfortable across React Native and native Android delivery.','years_of_experience',6,'skills',jsonb_build_array('React Native','Kotlin','TypeScript','Firebase'),'languages',jsonb_build_array('English','Mandarin','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Senior Mobile Engineer','company','AirAsia','industry','Airline','duration','2019-Present','summary','Rebuilt booking flow in React Native.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Software Engineering','institution','APU','year','2018')))
  ) returning id into a20;

  -- ---------- applications (candidate -> job, with stage + AI match) ----------
  -- Covers EVERY stage: applied, shortlisted, interviewing, offer, hired,
  -- declined (candidate said no), rejected (we said no).
  -- match_reasons is a jsonb column, so each rationale is wrapped as a JSON string.
  insert into public.applications (company_id, candidate_id, job_id, stage, match_score, match_reasons, source, fit) values
  -- Senior Frontend Engineer (j1)
  (co.id,a1,j1,'interviewing',94,to_jsonb('Strong design-system ownership and 6 years of production React with TypeScript match the core requirements.'::text),'LinkedIn','strong'),
  (co.id,a3,j1,'shortlisted',88,to_jsonb('Excellent React and TypeScript depth; creative UI background fits the design-system focus.'::text),'Career Page','strong'),
  (co.id,a4,j1,'applied',82,to_jsonb('Full-stack with a frontend lean; solid TypeScript, slightly less design-system experience.'::text),'Referral','strong'),
  (co.id,a5,j1,'applied',76,to_jsonb('Good React fundamentals and accessibility focus; earlier in career than the seniority target.'::text),'Career Page','strong'),
  (co.id,a15,j1,'rejected',68,to_jsonb('Solid React and testing, but no design-system ownership at the scale this role needs.'::text),'JobStreet','other'),
  (co.id,a2,j1,'rejected',52,to_jsonb('Primarily Vue and WordPress; limited production React with TypeScript.'::text),'Career Page','other'),
  -- WordPress Developer (j2)
  (co.id,a2,j2,'shortlisted',85,to_jsonb('Hands-on WordPress, PHP and WooCommerce match the role well.'::text),'JobStreet','strong'),
  (co.id,a6,j2,'offer',90,to_jsonb('Six years of WordPress and deep WooCommerce experience; strong fit.'::text),'Indeed','strong'),
  (co.id,a17,j2,'interviewing',80,to_jsonb('Agency WordPress delivery experience with Elementor and PHP.'::text),'Career Page','strong'),
  -- Product Designer (j3)
  (co.id,a7,j3,'interviewing',91,to_jsonb('Five years of research-led product design with strong Figma and systems work.'::text),'LinkedIn','strong'),
  (co.id,a1,j3,'shortlisted',79,to_jsonb('Design-system and Figma experience transfer well to product design.'::text),'Career Page','strong'),
  (co.id,a16,j3,'applied',84,to_jsonb('Strong visual craft and prototyping; slightly lighter on research practice.'::text),'Career Page','strong'),
  -- Talent Acquisition Specialist (j4, closed)
  (co.id,a8,j4,'hired',87,to_jsonb('Proven tech recruiting with measurable time-to-hire improvements.'::text),'Referral','strong'),
  -- Backend Engineer (j5)
  (co.id,a9,j5,'offer',93,to_jsonb('Seven years of Node.js with deep PostgreSQL performance work; matches the seniority target.'::text),'LinkedIn','strong'),
  (co.id,a11,j5,'interviewing',81,to_jsonb('Solid Node.js and container experience; less PostgreSQL depth than preferred.'::text),'Career Page','strong'),
  (co.id,a4,j5,'shortlisted',78,to_jsonb('Full-stack background covers Node.js and PostgreSQL, though frontend-leaning.'::text),'Referral','strong'),
  (co.id,a13,j5,'declined',72,to_jsonb('Capable engineer but mobile-focused; withdrew to pursue a mobile role.'::text),'LinkedIn','other'),
  -- QA Engineer (j6)
  (co.id,a10,j6,'hired',92,to_jsonb('Strong Playwright automation plus release sign-off ownership; exactly the profile.'::text),'JobStreet','strong'),
  (co.id,a19,j6,'declined',88,to_jsonb('QA lead with excellent strategy depth; declined over seniority and scope.'::text),'LinkedIn','strong'),
  (co.id,a12,j6,'shortlisted',74,to_jsonb('Strong manual coverage, automation still developing.'::text),'Career Page','strong'),
  -- Digital Marketing Executive (j7)
  (co.id,a14,j7,'interviewing',86,to_jsonb('Hands-on Google and Meta Ads with SEO content experience at the right level.'::text),'Career Page','strong'),
  (co.id,a18,j7,'applied',70,to_jsonb('Strong growth marketer, but well above the junior scope of this role.'::text),'LinkedIn','other'),
  -- Mobile Engineer (j8, draft) — talent pool interest ahead of publishing
  (co.id,a13,j8,'shortlisted',95,to_jsonb('Five years React Native with shipped App Store and Play Store releases.'::text),'Referral','strong'),
  (co.id,a20,j8,'applied',89,to_jsonb('React Native plus native Android depth; strong release experience.'::text),'LinkedIn','strong');

  -- ---------- interviews ----------
  -- Full coverage for the Interviews tab:
  --   * UP NEXT   - status 'scheduled', scheduled_at in the future
  --   * PAST      - status 'scheduled', scheduled_at behind now (the tab derives
  --                 "past" from the timestamp, there is no separate status)
  --   * AWAITING  - status 'sent', scheduled_at null + proposed_slots offered to
  --                 the candidate, who has not picked a time yet
  --   * RESCHEDULE- status 'reschedule', the candidate could not make the offered
  --                 times and suggested their own (previous_at keeps the old date)
  -- proposed_slots is [{start,end}] with ISO-8601 Z strings, which is what the
  -- scheduling panel parses.
  insert into public.interviews (company_id, candidate_id, job_id, interviewer_id, interviewer_name, interviewer_email, scheduled_at, status, provider, meeting_link, attendees, proposed_slots, reschedule_note, previous_at) values
  -- Up next (the three nearest, then two more)
  (co.id,a1,j1,owner_id,owner_name,owner_email, now() + interval '1 day 4 hours','scheduled','google','https://meet.google.com/ast-fron-001',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)), '[]'::jsonb, null, null),
  (co.id,a7,j3,owner_id,owner_name,owner_email, now() + interval '2 days 2 hours','scheduled','google','https://meet.google.com/ast-desg-002',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)), '[]'::jsonb, null, null),
  (co.id,a11,j5,owner_id,owner_name,owner_email, now() + interval '3 days 1 hour','scheduled','google','https://meet.google.com/ast-back-003',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)), '[]'::jsonb, null, null),
  (co.id,a14,j7,owner_id,owner_name,owner_email, now() + interval '4 days 3 hours','scheduled','google','https://meet.google.com/ast-mktg-004',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)), '[]'::jsonb, null, null),
  (co.id,a17,j2,owner_id,owner_name,owner_email, now() + interval '5 days 2 hours','scheduled','google','https://meet.google.com/ast-wpdv-005',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)), '[]'::jsonb, null, null),
  -- Past (already happened; these are the ones with scorecards)
  (co.id,a10,j6,owner_id,owner_name,owner_email, now() - interval '24 days 2 hours','scheduled','google','https://meet.google.com/ast-qaen-101',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email,'attended',true)), '[]'::jsonb, null, null),
  (co.id,a8,j4,owner_id,owner_name,owner_email, now() - interval '41 days 3 hours','scheduled','google','https://meet.google.com/ast-tale-102',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email,'attended',true)), '[]'::jsonb, null, null),
  (co.id,a6,j2,owner_id,owner_name,owner_email, now() - interval '9 days 5 hours','scheduled','google','https://meet.google.com/ast-wpdv-103',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email,'attended',true)), '[]'::jsonb, null, null),
  (co.id,a9,j5,owner_id,owner_name,owner_email, now() - interval '4 days 1 hour','scheduled','google','https://meet.google.com/ast-back-104',
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email,'attended',true)), '[]'::jsonb, null, null),
  -- Awaiting the candidate: times offered, no reply yet
  (co.id,a3,j1,owner_id,owner_name,owner_email, null,'sent','google',null,
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)),
    jsonb_build_array(
      jsonb_build_object('start', to_char((now() + interval '6 days 2 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '6 days 3 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('start', to_char((now() + interval '7 days 4 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '7 days 5 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('start', to_char((now() + interval '8 days 1 hour')  at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '8 days 2 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    ), null, null),
  (co.id,a16,j3,owner_id,owner_name,owner_email, null,'sent','google',null,
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)),
    jsonb_build_array(
      jsonb_build_object('start', to_char((now() + interval '5 days 6 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '5 days 7 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('start', to_char((now() + interval '6 days 8 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '6 days 9 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    ), null, null),
  -- Candidate could not make the offered times and proposed their own
  (co.id,a12,j6,owner_id,owner_name,owner_email, null,'reschedule','google',null,
    jsonb_build_array(jsonb_build_object('id',owner_id,'name',owner_name,'email',owner_email)),
    jsonb_build_array(
      jsonb_build_object('start', to_char((now() + interval '9 days 3 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'end', to_char((now() + interval '9 days 4 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('start', to_char((now() + interval '10 days 2 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'end', to_char((now() + interval '10 days 3 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    ),
    'Clashes with my current notice period handover. Could we do later in the week?', now() + interval '2 days 6 hours');

  -- ---------- scorecards ----------
  insert into public.scorecards (company_id, candidate_id, job_id, interviewer_id, ratings, notes) values
  (co.id,a1,j1,owner_id, jsonb_build_object('technical',4,'communication',4,'cultureFit',3,'experience',4),'Strong systems thinking. Clear communicator. Would move to offer.'),
  (co.id,a6,j2,owner_id, jsonb_build_object('technical',4,'communication',3,'cultureFit',4,'experience',4),'Deep WooCommerce knowledge, pragmatic. Recommend hire.'),
  (co.id,a9,j5,owner_id, jsonb_build_object('technical',5,'communication',4,'cultureFit',4,'experience',5),'Excellent depth on query tuning and API design. Strong offer candidate.'),
  (co.id,a10,j6,owner_id, jsonb_build_object('technical',4,'communication',4,'cultureFit',5,'experience',4),'Great automation instincts and ownership. Hired.'),
  (co.id,a7,j3,owner_id, jsonb_build_object('technical',4,'communication',5,'cultureFit',4,'experience',4),'Research-led and articulate. Portfolio backs up the claims.');

  -- ---------- interview polls (panel "which time works?" requests) ----------
  -- One OPEN poll still collecting votes, and one CLOSED poll that landed on a
  -- chosen slot. Polls cascade off candidates, so the wipe above clears them.
  insert into public.interview_polls (company_id, candidate_id, job_id, created_by, status, created_at)
  values (co.id, a4, j5, owner_id, 'open', now() - interval '2 days')
  returning id into p1;

  insert into public.interview_poll_slots (poll_id, company_id, slot_ts, slot_end) values
  (p1, co.id, now() + interval '6 days 2 hours', now() + interval '6 days 3 hours') returning id into s1;
  insert into public.interview_poll_slots (poll_id, company_id, slot_ts, slot_end) values
  (p1, co.id, now() + interval '7 days 3 hours', now() + interval '7 days 4 hours') returning id into s2;
  insert into public.interview_poll_slots (poll_id, company_id, slot_ts, slot_end) values
  (p1, co.id, now() + interval '8 days 5 hours', now() + interval '8 days 6 hours') returning id into s3;

  -- A real panel member has voted for two slots (a manager poll needs >=2 picks
  -- to count that person as "voted"), so the card shows genuine progress. Votes
  -- from the creator are excluded from the panel, so they would count for nothing.
  if panel_id is not null then
    insert into public.interview_poll_votes (poll_id, slot_id, company_id, profile_id, voter_name)
    select p1, s1, co.id, panel_id, coalesce(pr.full_name, 'Interviewer') from public.profiles pr where pr.id = panel_id
    on conflict (slot_id, profile_id) do nothing;
    insert into public.interview_poll_votes (poll_id, slot_id, company_id, profile_id, voter_name)
    select p1, s2, co.id, panel_id, coalesce(pr.full_name, 'Interviewer') from public.profiles pr where pr.id = panel_id
    on conflict (slot_id, profile_id) do nothing;
  end if;

  insert into public.interview_polls (company_id, candidate_id, job_id, created_by, status, chosen_slot, created_at, closed_at)
  values (co.id, a1, j1, owner_id, 'closed', now() + interval '1 day 4 hours', now() - interval '6 days', now() - interval '4 days')
  returning id into p2;

  insert into public.interview_poll_slots (poll_id, company_id, slot_ts, slot_end) values
  (p2, co.id, now() + interval '1 day 4 hours', now() + interval '1 day 5 hours') returning id into s4;
  insert into public.interview_poll_slots (poll_id, company_id, slot_ts, slot_end) values
  (p2, co.id, now() + interval '2 days 7 hours', now() + interval '2 days 8 hours') returning id into s5;

  if panel_id is not null then
    insert into public.interview_poll_votes (poll_id, slot_id, company_id, profile_id, voter_name)
    select p2, s4, co.id, panel_id, coalesce(pr.full_name, 'Interviewer') from public.profiles pr where pr.id = panel_id
    on conflict (slot_id, profile_id) do nothing;
  end if;

  -- ---------- offers ----------
  -- Mirrors the application stages above: 'offer' stage -> a sent offer awaiting
  -- a response; 'hired' -> an accepted + signed offer; 'declined' -> the
  -- candidate turned it down. Signed rows carry Aster Sign fields.
  insert into public.offers (company_id, candidate_id, job_id, status, offer_job_title, base_salary, salary_currency, employment_type, start_date, expires_at, message, viewed_at, responded_at, signed_name, signature_type, signed_at, esign_status) values
  -- Awaiting response
  (co.id,a6,j2,'sent','WordPress Developer',6500,'MYR','full_time',(now() + interval '30 days')::date,(now() + interval '7 days')::date,
   'We were impressed by your WooCommerce depth and would love to have you on the team.', now() - interval '1 day', null, null, null, null, 'sent'),
  (co.id,a9,j5,'sent','Backend Engineer (Node.js)',13000,'MYR','full_time',(now() + interval '45 days')::date,(now() + interval '10 days')::date,
   'Your API and PostgreSQL experience is exactly what we need as we scale.', now() - interval '6 hours', null, null, null, null, 'sent'),
  -- Accepted and signed
  (co.id,a8,j4,'accepted','Talent Acquisition Specialist',7000,'MYR','full_time',(now() - interval '20 days')::date,(now() - interval '35 days')::date,
   'Delighted to offer you the role. Looking forward to building the hiring team with you.', now() - interval '40 days', now() - interval '38 days', 'Farah Adya','typed', now() - interval '38 days','signed'),
  (co.id,a10,j6,'accepted','QA Engineer',8000,'MYR','full_time',(now() - interval '5 days')::date,(now() - interval '18 days')::date,
   'Your automation work stood out. Welcome aboard.', now() - interval '22 days', now() - interval '21 days', 'Chloe Tan','drawn', now() - interval '21 days','signed'),
  -- Declined by the candidate
  (co.id,a13,j5,'declined','Backend Engineer (Node.js)',11500,'MYR','full_time',(now() + interval '30 days')::date,(now() - interval '3 days')::date,
   'We think you would be a great addition to the backend team.', now() - interval '12 days', now() - interval '9 days', null, null, null, 'declined'),
  (co.id,a19,j6,'declined','QA Engineer',8500,'MYR','full_time',(now() + interval '21 days')::date,(now() - interval '2 days')::date,
   'We would love for you to lead quality here.', now() - interval '14 days', now() - interval '11 days', null, null, null, 'declined');

  -- ---------- activity log (populates the notifications feed) ----------
  -- Spread across the last few weeks, newest last so the feed has depth.
  insert into public.activity_log (company_id, type, title, description, candidate_id, job_id, actor_id, created_at) values
  (co.id,'new_application','Farah Adya applied','Applied for Talent Acquisition Specialist',a8,j4,null, now() - interval '45 days'),
  (co.id,'offer_signed','Farah Adya signed their offer','Talent Acquisition Specialist offer accepted',a8,j4,null, now() - interval '38 days'),
  (co.id,'hired','Farah Adya was hired','Started as Talent Acquisition Specialist',a8,j4,owner_id, now() - interval '37 days'),
  (co.id,'new_application','Chloe Tan applied','Applied for QA Engineer',a10,j6,null, now() - interval '30 days'),
  (co.id,'scorecard','Scorecard submitted for Chloe Tan','QA Engineer interview scored 4.25/5',a10,j6,owner_id, now() - interval '24 days'),
  (co.id,'offer_signed','Chloe Tan signed their offer','QA Engineer offer accepted',a10,j6,null, now() - interval '21 days'),
  (co.id,'hired','Chloe Tan was hired','Started as QA Engineer',a10,j6,owner_id, now() - interval '20 days'),
  (co.id,'offer_declined','Zainal Abidin declined the offer','QA Engineer offer was turned down',a19,j6,null, now() - interval '11 days'),
  (co.id,'offer_declined','Bryan Lee declined the offer','Backend Engineer offer was turned down',a13,j5,null, now() - interval '9 days'),
  (co.id,'new_application','Ong Wei Jie applied','Applied for Senior Frontend Engineer (React)',a15,j1,null, now() - interval '8 days'),
  (co.id,'new_application','Sofia Ahmad applied','Applied for Product Designer (UI/UX)',a16,j3,null, now() - interval '6 days'),
  (co.id,'interview_requested','Times sent to Siti Rahman','Senior Frontend Engineer (React), 3 slots offered',a3,j1,owner_id, now() - interval '4 days'),
  (co.id,'interview_requested','Panel poll opened for Marcus Lim','Backend Engineer (Node.js), waiting on panel votes',a4,j5,owner_id, now() - interval '2 days 4 hours'),
  (co.id,'offer_sent','Offer sent to Kevin Wong','WordPress Developer, RM 6,500 / month',a6,j2,owner_id, now() - interval '2 days'),
  (co.id,'interview_requested','Aisha Latif proposed new times','QA Engineer, candidate could not make the offered slots',a12,j6,null, now() - interval '1 day 8 hours'),
  (co.id,'interview_requested','Times sent to Sofia Ahmad','Product Designer (UI/UX), 2 slots offered',a16,j3,owner_id, now() - interval '20 hours'),
  (co.id,'interview_scheduled','Interview scheduled with Amira Hassan','Senior Frontend Engineer (React), tomorrow',a1,j1,owner_id, now() - interval '1 day'),
  (co.id,'offer_sent','Offer sent to Hafiz Ibrahim','Backend Engineer (Node.js), RM 13,000 / month',a9,j5,owner_id, now() - interval '8 hours'),
  (co.id,'new_application','Grace Lim applied','Applied for Mobile Engineer (React Native)',a20,j8,null, now() - interval '3 hours');

  raise notice 'Seeded expanded sample workspace for company %', co.id;
end loop;
if not found_co then
  raise notice 'No company "Lazy Sdn Bhd" was found, nothing seeded. Run:  select id, name from public.companies;  to see exact names, then adjust the WHERE clause in this file.';
end if;
end $$;
