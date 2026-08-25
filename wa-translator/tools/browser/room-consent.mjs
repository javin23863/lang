// Accept the room Terms exactly as a fresh invited participant must. Keeping
// this in the real-browser harness prevents acceptance tests from silently
// bypassing the affirmative-consent gate when room markup changes.
export async function acceptRoomTerms(page) {
  const before = await page.eval(`({
    checked: document.getElementById('termsAgree').checked,
    disabled: document.getElementById('joinBtn').disabled
  })`);
  if (before.checked || before.disabled !== true) {
    throw new Error(`fresh room must start with Terms unchecked and Join disabled: ${JSON.stringify(before)}`);
  }

  await page.tap("#termsAgree");
  const after = await page.eval(`({
    checked: document.getElementById('termsAgree').checked,
    disabled: document.getElementById('joinBtn').disabled
  })`);
  if (!after.checked || after.disabled) {
    throw new Error(`accepting Terms must enable Join: ${JSON.stringify(after)}`);
  }
  return {before, after};
}
