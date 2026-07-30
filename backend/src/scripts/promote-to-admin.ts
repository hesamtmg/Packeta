import { AppDataSource } from '../database/data-source';
import { User, UserRole } from '../users/entities/user.entity';

// One-off bootstrap: there's no UI for granting the first admin (or the
// first super-admin, who alone can promote others via the panel), since
// that would be a privilege-escalation hole.
// Run with: npm run promote-admin -- <email> [ADMIN|SUPER_ADMIN]
async function main() {
  const email = process.argv[2];
  const roleArg = (process.argv[3] ?? UserRole.ADMIN).toUpperCase();
  if (!email) {
    console.error(
      'Usage: npm run promote-admin -- <email> [ADMIN|SUPER_ADMIN]',
    );
    process.exitCode = 1;
    return;
  }
  if (roleArg !== UserRole.ADMIN && roleArg !== UserRole.SUPER_ADMIN) {
    console.error(`Role must be ADMIN or SUPER_ADMIN, got "${roleArg}"`);
    process.exitCode = 1;
    return;
  }
  const role = roleArg as UserRole;

  const dataSource = await AppDataSource.initialize();
  try {
    const result = await dataSource
      .getRepository(User)
      .update({ email }, { role });
    if (result.affected === 0) {
      console.error(`No user found with email "${email}"`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `${email} is now ${role === UserRole.SUPER_ADMIN ? 'a super admin' : 'an admin'}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main();
