import { readdir, readFile, writeFile } from 'node:fs/promises';
const directory = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
const parts = await Promise.all(files.map(async name => {
 const sql = await readFile(new URL(name, directory), 'utf8');
 if (!/^begin;\s/i.test(sql) || !/commit;\s*$/i.test(sql)) throw new Error(`Expected one outer transaction in ${name}`);
 return `-- ${name}\n${sql.replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '').trim()}`;
}));
const guard = `do $$ begin
 if to_regclass('public.profiles') is not null then
  raise exception 'The base schema already exists. Apply only the pending individual migrations instead of setup.sql.';
 end if;
end $$;`;
await writeFile(new URL('../supabase/setup.sql', import.meta.url), `-- Fresh database setup. Run once in Supabase SQL Editor.\n-- Creates the schema, booking notifications, and profiles for existing Auth accounts.\nbegin;\n${guard}\n\n${parts.join('\n\n')}\ncommit;\n`);
console.log('Prepared supabase/setup.sql');
