-- Выполните после supabase-schema.sql.
-- Назначает администратора только уже зарегистрированному пользователю.
update public.profiles as profile
set role = 'admin'
from auth.users as account
where profile.id = account.id
  and lower(account.email) = lower('YOUR_ADMIN_EMAIL');

-- Проверка результата:
select account.email, profile.role
from public.profiles as profile
join auth.users as account on account.id = profile.id
where lower(account.email) = lower('YOUR_ADMIN_EMAIL');
