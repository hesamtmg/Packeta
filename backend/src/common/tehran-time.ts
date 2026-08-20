const TEHRAN_TIME_ZONE = 'Asia/Tehran';

// Wallet/wallet-type auto-withdraw schedule times ("HH:MM") are entered by
// merchants in Iran local time. Comparing against the server's own
// getHours()/getMinutes() only worked by coincidence when the process
// happened to run in that timezone — a production container running UTC
// (the default) would silently fire every sweep 3-4.5 hours off. Intl's
// timeZone option gives the wall-clock time in Tehran regardless of what
// timezone the Node process itself is running under.
const tehranTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TEHRAN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function currentTehranTime(now: Date = new Date()): string {
  return tehranTimeFormatter.format(now);
}
