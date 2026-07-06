-- ============================================================================
-- Aster — sample workspace seed  (run once, after you've signed up)
-- ============================================================================
-- Fills every company that has NO jobs yet with a realistic set of jobs,
-- candidates, applications, interviews and scorecards, so a fresh workspace
-- looks populated. Run it in the Supabase SQL editor (it executes as the table
-- owner, so it bypasses RLS on purpose). Safe to re-run: companies that already
-- have jobs are skipped.

do $$
declare
  co        record;
  owner_id  uuid;
  j1 uuid; j2 uuid; j3 uuid; j4 uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; a7 uuid; a8 uuid; a9 uuid; a10 uuid;
begin
for co in
  select id from public.companies c
  where not exists (select 1 from public.jobs j where j.company_id = c.id)
loop
  -- Prefer the owner as author/interviewer; fall back to any profile.
  select id into owner_id from public.profiles
    where company_id = co.id order by (role = 'owner') desc, created_at limit 1;

  -- ---------- jobs ----------
  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Senior Frontend Engineer (React)', 'open', owner_id, jsonb_build_object(
    'department','Engineering','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','senior','salary_min',9000,'salary_max',13000,'salary_currency','MYR',
    'description','Lead our design system and component architecture, working closely with design and product.',
    'responsibilities', jsonb_build_array('Own and evolve the design system','Lead frontend architecture','Partner with designers on Figma-to-code','Mentor mid-level engineers','Champion accessibility and performance'),
    'requirements', jsonb_build_array('5+ years production React with TypeScript','Experience scaling a design system','Strong accessible, responsive CSS','Pixel-accurate Figma-to-UI','Clear code-review habits'),
    'benefits', jsonb_build_array('Health insurance','Flexible hours','Learning budget','Hybrid KL office','MacBook Pro')))
  returning id into j1;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'WordPress Developer', 'open', owner_id, jsonb_build_object(
    'department','Engineering','location','Petaling Jaya','employment_type','full_time',
    'remote_type','onsite','seniority_level','mid','salary_min',4500,'salary_max',7000,'salary_currency','MYR',
    'description','Build and maintain client websites on WordPress across PHP themes, plugins and custom builds.',
    'responsibilities', jsonb_build_array('Build and maintain WordPress sites','Develop custom themes and plugins','Set up WooCommerce stores','Handle performance, security, backups','Deliver pixel-accurate pages'),
    'requirements', jsonb_build_array('3+ years WordPress development','Solid PHP, HTML, CSS, JS','WooCommerce and page builders','Hosting, DNS, site security','Manage multiple client projects'),
    'benefits', jsonb_build_array('EPF & SOCSO','Medical coverage','Parking allowance','Team lunches','Clear career path')))
  returning id into j2;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Product Designer (UI/UX)', 'open', owner_id, jsonb_build_object(
    'department','Design','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','remote','seniority_level','mid','salary_min',6000,'salary_max',9500,'salary_currency','MYR',
    'description','Own end-to-end product design for our core hiring product, from research to polished UI.',
    'responsibilities', jsonb_build_array('Run discovery and usability research','Design flows, wireframes and hi-fi UI','Maintain the design system in Figma','Partner closely with engineering','Present work to stakeholders'),
    'requirements', jsonb_build_array('4+ years product design','Strong Figma and prototyping','Portfolio of shipped product work','Comfort with research and testing','Systems thinking'),
    'benefits', jsonb_build_array('Fully remote','Health insurance','Design conference budget','Latest hardware','Flexible hours')))
  returning id into j3;

  insert into public.jobs (company_id, title, status, created_by, details) values
  (co.id, 'Talent Acquisition Specialist', 'closed', owner_id, jsonb_build_object(
    'department','People','location','Kuala Lumpur','employment_type','full_time',
    'remote_type','hybrid','seniority_level','mid','salary_min',5000,'salary_max',8000,'salary_currency','MYR',
    'description','Drive full-cycle recruiting across engineering and design roles.',
    'responsibilities', jsonb_build_array('Own full-cycle recruiting','Source across channels','Run structured interviews','Improve time-to-hire','Own candidate experience'),
    'requirements', jsonb_build_array('3+ years in-house recruiting','Tech hiring experience','Structured interviewing','ATS fluency','Great communication'),
    'benefits', jsonb_build_array('Health insurance','Hybrid work','Referral bonuses','Learning budget','Wellness allowance')))
  returning id into j4;

  -- ---------- candidates (parsed resumes) ----------
  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Amira Hassan','amira.hassan@email.com','+60 12-345 6789','Kuala Lumpur, Malaysia','Senior frontend engineer focused on design systems and component architecture.',6,
    '["React","TypeScript","Tailwind","GraphQL","Node.js","Figma"]','amira_hassan_resume.pdf','parsed',true,
    jsonb_build_object('name','Amira Hassan','email','amira.hassan@email.com','phone','+60 12-345 6789','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example','portfolio_url','https://amirahassan.dev','summary','Senior frontend engineer focused on design systems and component architecture, with a track record of shipping performant, accessible UI at scale.','years_of_experience',6,'salary_expectation','RM 9,500 - 11,000 / month','skills',jsonb_build_array('React','TypeScript','Tailwind','GraphQL','Node.js','Figma'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('AWS Certified Cloud Practitioner'),'experience',jsonb_build_array(jsonb_build_object('title','Senior Frontend Engineer','company','Grabtech','duration','2021-Present','summary','Led design system rebuild, cut bundle size 40%.'),jsonb_build_object('title','Frontend Developer','company','Fave','duration','2018-2021','summary','Built checkout flows serving 2M+ MAU.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','Universiti Malaya','year','2018')))
  ) returning id into a1;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Daniel Teoh','daniel.teoh@email.com','+60 16-234 5678','Penang, Malaysia',null,4,
    '["Vue","JavaScript","CSS","WordPress","PHP"]','daniel_teoh_cv.pdf','parsed',false,
    jsonb_build_object('name','Daniel Teoh','email','daniel.teoh@email.com','phone','+60 16-234 5678','location','Penang, Malaysia','summary',null,'years_of_experience',4,'skills',jsonb_build_array('Vue','JavaScript','CSS','WordPress','PHP'),'languages',jsonb_build_array('English','Mandarin','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Web Developer','company','Freelance','duration','2020-Present','summary','Built 30+ SME sites for local Malaysian businesses.')),'education',jsonb_build_array(jsonb_build_object('degree','Diploma in IT','institution','TAR UC','year','2019')))
  ) returning id into a2;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Siti Rahman','siti.rahman@email.com','+60 19-876 5432','Cyberjaya, Malaysia','Creative frontend engineer blending 3D web experiences with production React.',3,
    '["React","Next.js","TypeScript","Three.js","GSAP","WebGL"]','siti_rahman_resume.pdf','parsed',true,
    jsonb_build_object('name','Siti Rahman','email','siti.rahman@email.com','phone','+60 19-876 5432','location','Cyberjaya, Malaysia','linkedin_url','https://linkedin.com/in/example2','portfolio_url','https://sitirahman.design','summary','Creative frontend engineer blending 3D web experiences with production-grade React.','years_of_experience',3,'skills',jsonb_build_array('React','Next.js','TypeScript','Three.js','GSAP','WebGL'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array('Meta Front-End Developer Professional Certificate'),'experience',jsonb_build_array(jsonb_build_object('title','Creative Frontend Engineer','company','Studio Kite','duration','2022-Present','summary','Built award-nominated 3D portfolio sites for agency clients.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Design','institution','The One Academy','year','2021')))
  ) returning id into a3;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Marcus Lim','marcus.lim@email.com','+60 12-987 6543','Kuala Lumpur, Malaysia','Full-stack engineer with a frontend lean and strong TypeScript fundamentals.',5,
    '["React","Node.js","PostgreSQL","AWS","TypeScript"]','marcus_lim_resume.pdf','parsed',true,
    jsonb_build_object('name','Marcus Lim','email','marcus.lim@email.com','phone','+60 12-987 6543','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example3','summary','Full-stack engineer with a frontend lean, strong TypeScript, and cloud experience.','years_of_experience',5,'skills',jsonb_build_array('React','Node.js','PostgreSQL','AWS','TypeScript'),'languages',jsonb_build_array('English','Mandarin'),'certifications',jsonb_build_array('AWS Solutions Architect Associate'),'experience',jsonb_build_array(jsonb_build_object('title','Full-Stack Engineer','company','iPrice Group','duration','2020-Present','summary','Owned pricing dashboards used across SEA.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Software Engineering','institution','APU','year','2019')))
  ) returning id into a4;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Nurul Aisyah','nurul.aisyah@email.com','+60 17-333 2211','Shah Alam, Malaysia','Frontend developer passionate about accessible, inclusive interfaces.',2,
    '["React","JavaScript","CSS","Accessibility"]','nurul_aisyah_cv.pdf','parsed',true,
    jsonb_build_object('name','Nurul Aisyah','email','nurul.aisyah@email.com','phone','+60 17-333 2211','location','Shah Alam, Malaysia','summary','Frontend developer passionate about accessible, inclusive interfaces.','years_of_experience',2,'skills',jsonb_build_array('React','JavaScript','CSS','Accessibility'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Frontend Developer','company','MoneyLion','duration','2022-Present','summary','Shipped accessible onboarding flows.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Sc. Computer Science','institution','UiTM','year','2022')))
  ) returning id into a5;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Kevin Wong','kevin.wong@email.com','+60 18-444 5566','Johor Bahru, Malaysia','WordPress and PHP developer with WooCommerce depth.',6,
    '["WordPress","PHP","WooCommerce","MySQL","JavaScript"]','kevin_wong_resume.pdf','parsed',false,
    jsonb_build_object('name','Kevin Wong','email','kevin.wong@email.com','phone','+60 18-444 5566','location','Johor Bahru, Malaysia','summary','WordPress and PHP developer with deep WooCommerce and hosting experience.','years_of_experience',6,'skills',jsonb_build_array('WordPress','PHP','WooCommerce','MySQL','JavaScript'),'languages',jsonb_build_array('English','Mandarin','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Senior WordPress Developer','company','Exabytes','duration','2018-Present','summary','Maintained 100+ client stores.')),'education',jsonb_build_array(jsonb_build_object('degree','Diploma in Computing','institution','Southern University College','year','2017')))
  ) returning id into a6;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Priya Nair','priya.nair@email.com','+60 11-222 3344','Kuala Lumpur, Malaysia','Product designer focused on research-led, systemised UI.',5,
    '["Figma","Prototyping","User Research","Design Systems"]','priya_nair_portfolio.pdf','parsed',true,
    jsonb_build_object('name','Priya Nair','email','priya.nair@email.com','phone','+60 11-222 3344','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example4','portfolio_url','https://priyanair.design','summary','Product designer focused on research-led, systemised UI and measurable outcomes.','years_of_experience',5,'skills',jsonb_build_array('Figma','Prototyping','User Research','Design Systems'),'languages',jsonb_build_array('English','Tamil','Malay'),'certifications',jsonb_build_array('NN/g UX Certification'),'experience',jsonb_build_array(jsonb_build_object('title','Product Designer','company','StashAway','duration','2021-Present','summary','Led redesign that lifted activation 18%.')),'education',jsonb_build_array(jsonb_build_object('degree','B.Des Communication Design','institution','Dasein Academy','year','2018')))
  ) returning id into a7;

  insert into public.candidates (company_id, full_name, email, phone, location, summary, years_experience, skills, file_name, status, has_photo, parsed) values
  (co.id,'Farah Adya','farah.adya@email.com','+60 13-555 7788','Kuala Lumpur, Malaysia','Talent acquisition specialist with strong tech-hiring track record.',4,
    '["Sourcing","Interviewing","ATS","Employer Branding"]','farah_adya_resume.pdf','parsed',true,
    jsonb_build_object('name','Farah Adya','email','farah.adya@email.com','phone','+60 13-555 7788','location','Kuala Lumpur, Malaysia','linkedin_url','https://linkedin.com/in/example5','summary','Talent acquisition specialist with a strong track record hiring engineers and designers.','years_of_experience',4,'skills',jsonb_build_array('Sourcing','Interviewing','ATS','Employer Branding'),'languages',jsonb_build_array('English','Malay'),'certifications',jsonb_build_array(),'experience',jsonb_build_array(jsonb_build_object('title','Talent Acquisition Specialist','company','Setel','duration','2021-Present','summary','Cut time-to-hire from 42 to 26 days.')),'education',jsonb_build_array(jsonb_build_object('degree','B.A. Human Resource Management','institution','Universiti Malaya','year','2019')))
  ) returning id into a8;

  -- ---------- applications (candidate -> job, with stage + AI match) ----------
  -- match_reasons is a jsonb column, so each rationale is wrapped as a JSON string.
  insert into public.applications (company_id, candidate_id, job_id, stage, match_score, match_reasons, source) values
  (co.id,a1,j1,'interviewing',94,to_jsonb('Strong design-system ownership and 6 years of production React with TypeScript match the core requirements.'::text),'LinkedIn'),
  (co.id,a3,j1,'shortlisted',88,to_jsonb('Excellent React and TypeScript depth; creative UI background fits the design-system focus.'::text),'Career Page'),
  (co.id,a4,j1,'applied',82,to_jsonb('Full-stack with a frontend lean; solid TypeScript, slightly less design-system experience.'::text),'Referral'),
  (co.id,a5,j1,'applied',76,to_jsonb('Good React fundamentals and accessibility focus; earlier in career than the seniority target.'::text),'Career Page'),
  (co.id,a1,j3,'shortlisted',79,to_jsonb('Design-system and Figma experience transfer well to product design.'::text),'Career Page'),
  (co.id,a7,j3,'interviewing',91,to_jsonb('Five years of research-led product design with strong Figma and systems work.'::text),'LinkedIn'),
  (co.id,a2,j2,'shortlisted',85,to_jsonb('Hands-on WordPress, PHP and WooCommerce match the role well.'::text),'JobStreet'),
  (co.id,a6,j2,'offer',90,to_jsonb('Six years of WordPress and deep WooCommerce experience; strong fit.'::text),'Indeed'),
  (co.id,a8,j4,'hired',87,to_jsonb('Proven tech recruiting with measurable time-to-hire improvements.'::text),'Referral');

  -- ---------- interviews ----------
  insert into public.interviews (company_id, candidate_id, job_id, interviewer_id, scheduled_at, status, provider) values
  (co.id,a1,j1,owner_id, now() + interval '1 day 4 hours','scheduled','google'),
  (co.id,a7,j3,owner_id, now() + interval '2 days 2 hours','scheduled','google');

  -- ---------- scorecards ----------
  insert into public.scorecards (company_id, candidate_id, job_id, interviewer_id, ratings, notes) values
  (co.id,a1,j1,owner_id, jsonb_build_object('technical',4,'communication',4,'cultureFit',3,'experience',4),'Strong systems thinking. Clear communicator. Would move to offer.'),
  (co.id,a6,j2,owner_id, jsonb_build_object('technical',4,'communication',3,'cultureFit',4,'experience',4),'Deep WooCommerce knowledge, pragmatic. Recommend hire.');

  raise notice 'Seeded sample workspace for company %', co.id;
end loop;
end $$;
