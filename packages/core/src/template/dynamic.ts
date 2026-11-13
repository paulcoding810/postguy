const FIRST = ['Ann', 'Ben', 'Chloe', 'David', 'Emma', 'Felix', 'Grace', 'Hugo', 'Isla', 'Jack', 'Kira', 'Liam', 'Maya', 'Noah', 'Olivia', 'Paul'];
const LAST = ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Nguyen', 'Garcia'];
const WORDS = ['alpha', 'bravo', 'cobalt', 'delta', 'ember', 'falcon', 'granite', 'harbor', 'indigo', 'juniper', 'kepler', 'lumen', 'meadow', 'nimbus', 'orbit', 'prism'];
const CITIES = ['London', 'Paris', 'Berlin', 'Madrid', 'Tokyo', 'Toronto', 'Sydney', 'Hanoi', 'Lisbon', 'Oslo'];
const COUNTRIES = ['United Kingdom', 'France', 'Germany', 'Spain', 'Japan', 'Canada', 'Australia', 'Vietnam', 'Portugal', 'Norway'];
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet', 'black', 'white', 'gray'];
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

const int = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
const chars = (n: number, from = ALNUM) => Array.from({ length: n }, () => pick([...from])).join('');
const day = 86_400_000;

const GENERATORS: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(int(0, 1000)),
  $randomBoolean: () => String(Math.random() < 0.5),
  $randomAlphaNumeric: () => chars(1),
  $randomHexadecimal: () => chars(1, '0123456789abcdef'),
  $randomAbbreviation: () => chars(3, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  $randomFirstName: () => pick(FIRST),
  $randomLastName: () => pick(LAST),
  $randomFullName: () => `${pick(FIRST)} ${pick(LAST)}`,
  $randomUserName: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${int(1, 99)}`,
  $randomEmail: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${int(1, 999)}@example.com`,
  $randomExampleEmail: () => `${pick(FIRST).toLowerCase()}${int(1, 999)}@example.com`,
  $randomPassword: () => chars(15),
  $randomPhoneNumber: () => `${int(200, 999)}-${int(200, 999)}-${int(1000, 9999)}`,
  $randomCity: () => pick(CITIES),
  $randomCountry: () => pick(COUNTRIES),
  $randomCountryCode: () => pick(['GB', 'FR', 'DE', 'ES', 'JP', 'CA', 'AU', 'VN', 'PT', 'NO']),
  $randomStreetAddress: () => `${int(1, 999)} ${pick(WORDS)[0]!.toUpperCase()}${pick(WORDS).slice(1)} Street`,
  $randomColor: () => pick(COLORS),
  $randomHexColor: () => `#${chars(6, '0123456789abcdef')}`,
  $randomIP: () => `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
  $randomIPV6: () => Array.from({ length: 8 }, () => chars(4, '0123456789abcdef')).join(':'),
  $randomUrl: () => `https://${pick(WORDS)}.example.com`,
  $randomDomainName: () => `${pick(WORDS)}.example.com`,
  $randomWord: () => pick(WORDS),
  $randomWords: () => Array.from({ length: int(2, 5) }, () => pick(WORDS)).join(' '),
  $randomLoremWord: () => pick(WORDS),
  $randomLoremSentence: () => {
    const s = Array.from({ length: int(5, 10) }, () => pick(WORDS)).join(' ');
    return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
  },
  $randomCompanyName: () => `${pick(LAST)} ${pick(['Ltd', 'Inc', 'Group', 'Labs'])}`,
  $randomJobTitle: () => pick(['Engineer', 'Designer', 'Manager', 'Analyst', 'Director', 'Consultant']),
  $randomPrice: () => (Math.random() * 1000).toFixed(2),
  $randomCurrencyCode: () => pick(['USD', 'EUR', 'GBP', 'JPY', 'VND', 'CAD']),
  $randomDatePast: () => new Date(Date.now() - int(1, 365) * day).toUTCString(),
  $randomDateFuture: () => new Date(Date.now() + int(1, 365) * day).toUTCString(),
  $randomDateRecent: () => new Date(Date.now() - int(0, 2 * day)).toUTCString(),
};

/** Postman-style built-in variables such as {{$guid}} and {{$timestamp}}; a new value on every use. */
export function dynamicVariable(name: string): string | undefined {
  return GENERATORS[name]?.();
}

export const DYNAMIC_VARIABLES = Object.keys(GENERATORS);
