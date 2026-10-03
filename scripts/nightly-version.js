// Nightly version from the last stable tag: v1.2.3 → 1.2.4-nightly.<yyyymmdd>.<sha>
// PHP's version_compare() puts it after 1.2.3 and before 1.2.4, so the next stable release is offered as an update.
// Usage: node scripts/nightly-version.js <last stable tag | ""> <yyyymmdd> <short sha>
function nightlyVersion(tag, date, sha) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag || '') || [null, 0, 0, 0];
  return `${m[1]}.${m[2]}.${+m[3] + 1}-nightly.${date}.${sha}`;
}

if (require.main === module) {
  const [tag, date, sha] = process.argv.slice(2);
  if (!/^\d{8}$/.test(date || '') || !sha) {
    console.error('usage: nightly-version.js <tag> <yyyymmdd> <sha>');
    process.exit(1);
  }
  console.log(nightlyVersion(tag, date, sha));
}

module.exports = { nightlyVersion };
