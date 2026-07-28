import { AppDataSource } from '../database/data-source';
import { User, UserRole } from '../users/entities/user.entity';

// One-off bootstrap: there's no UI for granting the first admin, since that
// would be a privilege-escalation hole. Run with: npm run promote-admin -- <email>
async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run promote-admin -- <email>');
    process.exitCode = 1;
    return;
  }

  const dataSource = await AppDataSource.initialize();
  try {
    const result = await dataSource
      .getRepository(User)
      .update({ email }, { role: UserRole.ADMIN });
    if (result.affected === 0) {
      console.error(`No user found with email "${email}"`);
      process.exitCode = 1;
      return;
    }
    console.log(`${email} is now an admin.`);
  } finally {
    await dataSource.destroy();
  }
}

main();
