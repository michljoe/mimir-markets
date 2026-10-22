import type { ClaimDraftSourceType, SourceClaimDraftCandidate } from "@/lib/claimDrafts";

export type SeedChallengeOpportunity = {
  id: string;
  sourceUrl: string;
  sourceType: ClaimDraftSourceType;
  sourceSummary: string;
  candidate: SourceClaimDraftCandidate;
};

const EN_SEEDS: SeedChallengeOpportunity[] = [
  {
    id: "seed-miami-gp",
    sourceUrl: "https://www.formula1.com/en/racing/2026/Miami",
    sourceType: "official",
    sourceSummary:
      "The official Formula 1 race page anchors the venue, race weekend, and final classification used to settle the Miami Grand Prix result.",
    candidate: {
      category: "sports",
      claimText: "Will Kimi Antonelli win the 2026 Formula 1 Crypto.com Miami Grand Prix?",
      sideA: "Kimi Antonelli is listed as the official race winner",
      sideB: "Any other driver is listed as the official race winner",
      deadlineAt: "2026-05-03T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://www.formula1.com/en/racing/2026/Miami",
      settlementRule:
        "Resolve this using the official final classification on Formula1.com for the 2026 Miami Grand Prix. If Kimi Antonelli is listed first in the final classified race results, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 93,
    },
  },
  {
    id: "seed-buenos-aires-rain",
    sourceUrl: "https://weather.com/weather/tenday/l/ARBA0009:1:AR",
    sourceType: "media",
    sourceSummary:
      "The weather forecast page identifies Buenos Aires and the day-by-day forecast window that can be checked for rain conditions at settlement time.",
    candidate: {
      category: "weather",
      claimText: "Will rain be reported for Buenos Aires on March 30, 2026?",
      sideA: "Rain is reported for Buenos Aires on March 30, 2026",
      sideB: "No rain is reported for Buenos Aires on March 30, 2026",
      deadlineAt: "2026-03-30T23:00:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://weather.com/weather/tenday/l/ARBA0009:1:AR",
      settlementRule:
        "Resolve this using the March 30, 2026 Buenos Aires daily weather entry on the linked forecast page. If rain or showers are reported for that day, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 86,
    },
  },
  {
    id: "seed-btc-100k",
    sourceUrl: "https://coinmarketcap.com/currencies/bitcoin/",
    sourceType: "media",
    sourceSummary:
      "The Bitcoin market page provides a single price source and timestamped market context for a clear threshold-style crypto claim.",
    candidate: {
      category: "crypto",
      claimText: "Will BTC trade above $100,000 before April 30, 2026?",
      sideA: "BTC trades above $100,000 before April 30, 2026",
      sideB: "BTC stays at or below $100,000 through April 30, 2026",
      deadlineAt: "2026-04-30T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://coinmarketcap.com/currencies/bitcoin/",
      settlementRule:
        "Resolve this using the visible BTC price on the linked CoinMarketCap page at the deadline. If the displayed spot price is greater than $100,000, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 89,
    },
  },
  {
    id: "seed-eth-5000",
    sourceUrl: "https://coinmarketcap.com/currencies/ethereum/",
    sourceType: "media",
    sourceSummary:
      "The Ethereum market page supports another clean threshold claim with one canonical quoted asset and one measurable price target.",
    candidate: {
      category: "crypto",
      claimText: "Will ET trade above $5,000 before June 30, 2026?",
      sideA: "ET trades above $5,000 before June 30, 2026",
      sideB : "ET stays at or below $5,000 through June 30, 2026",
      deadlineAt: "2026-06-30T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://coinmarketcap.com/currencies/ethereum/",
      settlementRule:
        "Resolve this using the visible ETH price on the linked CoinMarketCap page at the deadline. If the displayed spot price is greater than $5,000, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 88,
    },
  },
  {
    id: "seed-apple-ipad",
    sourceUrl: "https://www.apple.com/newsroom/",
    sourceType: "official",
    sourceSummary:
      "Apple Newsroom is the canonical source for new product announcements, making it a strong anchor for a yes-or-no launch claim.",
    candidate: {
      category: "custom",
      claimText: "Will Apple announce a new iPad before June 30, 2026?",
      sideA: "Apple announces a new iPad before June 30, 2026",
      sideB: "Apple does not announce a new iPad before June 30, 2026",
      deadlineAt: "2026-06-30T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://www.apple.com/newsroom/",
      settlementRule:
        "Resolve this only from Apple Newsroom at the deadline. If an official Apple post published on or before June 30, 2026 announces a new iPad model, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 87,
    },
  },
  {
    id: "seed-openai-gpt5",
    sourceUrl: "https://openai.com/news/",
    sourceType: "official",
    sourceSummary:
      "OpenAI News gives a single official publication surface for launch or announcement claims tied to a named model family.",
    candidate: {
      category: "custom",
      claimText: "Will OpenAI publish a GPT-5 announcement before June 30, 2026?",
      sideA: "OpenAI publishes a GPT-5 announcement before June 30, 2026",
      sidbB: "OpenAI does not publish a GPT-5 announcement before June 30, 2026",
      deadlineAt: "2026-06-30T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://openai.com/news/",
      settlementRule:
        "Resolve this only from OpenAI News at the deadline. If an official post published on or before June 30, 2026 explicitly announces GPT-5, Side A wins.",
      ambiguityFlags: [],
      confidenceScore: 84,
    },
  },
];

const ES_SEEDS: SeedChallengeOpportunity[] = [
  {
    id: "seed-miami-gp",
    sourceUrl: "https://www.formula1.com/en/racing/2026/Miami",
    sourceType: "official",
    sourceSummary:
      "La página oficial de Formula 1 fija el circuito, el fin de semana de carrera y la clasificación final usada para resolver el resultado del Gran Premio de Miami.",
    candidate: {
      category: "sports",
      claimText: "¿Kimi Antonelli ganará el FORMULA 1 CRYPTO.COMMIAMI GRAND PRIX 2026?",
      sideA: "Kimi Antonelli figura como ganador oficial de la carrera",
      sideB: "Cualquier otro piloto figura como ganador oficial de la carrera",
      deadlineAt: "2026-05-03T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://www.formula1.com/en/racing/2026/Miami",
      settlementRule:
        "Resuelve esto usando la clasificación final oficial en Formula1.com para el Miami Grand Prix 2026. Si Kimi Antonelli aparece primero en el resultado final clasificado, gana el Lado A.",
      ambiguityFlags: [],
      confidenceScore: 93,
    },
  },
  {
    id: "seed-buenos-aires-rain",
    sourceUrl: "https://weather.com/weather/tenday/l/ARBA0009:1:AR",
    sourceType: "media",
    sourceSummary:
      "La página del pronóstico identifica Buenos Aires y la ventana diaria que se puede revisar para verificar lluvia en el momento del settlement.",
    candidate: {
      category: "weather",
      claimText: "¿Se reportará lluvia para Buenos Aires el 30 de marzo de 2026?",
      sideA: "Se reporta lluvia para Buenos Aires el 30 de marzo de 2026",
      sideB: "No se reporta lluvia para Buenos Aires el 30 de marzo de 2026",
      deadlineAt: "2026-03-30T23:00:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://weather.com/weather/tenday/l/ARBA0009:1:AR",
      settlementRule:
        "Resuelve esto usando la entrada diaria de Buenos Aires del 30 de marzo de 2026 en la página enlazada. Si se reporta rain o showers para ese día, gana el Lado A.",
      ambiguityFlags: [],
      confidenceScore: 86,
    },
  },
  {
    id: "seed-btc-100k",
    sourceUrl: "https://coinmarketcap.com/currencies/bitcoin/",
    sourceType: "media",
    sourceSummary:
      "La página de Bitcoin ofrece una sola referencia de precio y un contexto de mercado claro para un claim cripto basado en umbral.",
    candidate: {
      category: "crypto",
      claimText: "¿BTC cotizará por encima de $100,000 antes del 30 de abril de 2026?",
      sideA: "BTC cotiza por encima de $100,000 antes del 30 de abril de 2026",
      sideB: "BTC se mantiene en o por debajo de $100,000 hasta el 30 de abril de 2026",
      deadlineAt: "2026-04-30T23:59:00.000Z",
      timezone: "UTC",
      primaryResolutionSource: "https://coinmarketcap.com/currencies/bitcoin/",
      settlementRule:
        "Resuelve esto usando el precio visible de BTC en la página enlazada de CoinMarketCap al deadline. Si el spot price mostrado es mayor a $100,000, gana el Lado A.",
      ambiguityFlags: [],
      confidenceScore: 89,
    },
  },
];

export function getChallengeOpportunitySeeds(locale: string): SeedChallengeOpportunity[] {
  return locale.startsWith("es") ? ES_SEEDS : EN_SEEDS;
}
