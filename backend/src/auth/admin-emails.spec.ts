import { parseAdminEmails } from './admin-emails';

describe('parseAdminEmails', () => {
  it('пусто/undefined -> []', () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails('')).toEqual([]);
    expect(parseAdminEmails('  ,  ,')).toEqual([]);
  });

  it('разбивает по запятой, trim + lowercase, убирает дубли', () => {
    expect(parseAdminEmails(' A@B.md , a@b.md ,Boss@X.io')).toEqual(['a@b.md', 'boss@x.io']);
  });
});
