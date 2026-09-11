import { restoreBackup } from "../server/backups.mjs";
const [file, keyFile, directory] = process.argv.slice(2);
if (!file || !keyFile || !directory) {
  console.error(
    "Usage: node scripts/restore-backup.mjs <archive.wlbackup> <recovery-key-file> <stopped-data-directory>",
  );
  process.exit(1);
}
console.log(JSON.stringify(restoreBackup({ file, keyFile, directory }), null, 2));
