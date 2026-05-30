import assert from "node:assert/strict";
import test from "node:test";

const cases = [
  {
    name: "Protein Boogie Bar",
    url: "https://www.fitnessnord.com/protein-boogie-bar-1-x-60-g-peanut-butter",
    expectedProtein: [18, 18]
  },
  {
    name: "Nutrend Carnitine activity drink",
    url: "https://www.fitnessnord.com/nutrend-carnitine-aktivitetsdrik-750-ml-coconut-blueberry",
    expectedProtein: [1.2, 1.5]
  },
  {
    name: "USN Bluelab 100% Whey Protein 2 kg",
    url: "https://www.fitnessnord.com/usn-bluelab-100-whey-protein-2-kg",
    expectedProtein: [1450, 1490]
  },
  {
    name: "Vegansk Layer Bar",
    url: "https://www.fitnessnord.com/vegansk-layer-bar-1-x-55-g",
    expectedProtein: [10, 20]
  },
  {
    name: "25g protein + 4g creatine bar",
    url: "https://www.fitnessnord.com/bar-med-25g-protein-og-4-gram-kreatin-50-g-cacao",
    expectedProtein: [25, 25]
  },
  {
    name: "High quality whey with L-leucine 500 g",
    url: "https://www.fitnessnord.com/hojkvalitets-valleprotein-med-l-leucin-500-g",
    expectedProtein: [350, 430]
  },
  {
    name: "Whey Protein 3 x 330 g",
    url: "https://www.fitnessnord.com/whey-protein-3-x-330-g-vanilla",
    expectedProtein: [700, 850]
  },
  {
    name: "Case 12 x A-47 Labs protein bar 35 g",
    url: "https://www.fitnessnord.com/case-12-x-a-47-labs-protein-bar-1-x-35-g-chocolate-banana-18001",
    expectedProtein: [120, 180]
  }
];

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&oslash;/gi, "ø")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&aelig;/gi, "æ")
    .replace(/&AElig;/g, "Æ")
    .replace(/&aring;/gi, "å")
    .replace(/&Aring;/g, "Å")
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function stripTags(html) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  return Number(value.replace(",", "."));
}

function parsePackageInfo(text) {
  const normalized = text.replace(/\s+/g, " ");
  const caseNested = normalized.match(/(?:case|kasse|box)\D{0,40}(\d+)\s*x\D{0,80}\(\s*(?:\d+\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g)\s*\)/i);
  if (caseNested) {
    const units = parseNumber(caseNested[1]);
    const unitAmount = parseNumber(caseNested[2]);
    const unitGrams = caseNested[3].toLowerCase() === "kg" ? unitAmount * 1000 : unitAmount;
    return { totalGrams: units * unitGrams, unitGrams, units };
  }

  const nestedMulti = normalized.match(/(\d+)\s*x\D{0,80}\(\s*(?:\d+\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g)\s*\)/i);
  if (nestedMulti) {
    const units = parseNumber(nestedMulti[1]);
    const unitAmount = parseNumber(nestedMulti[2]);
    const unitGrams = nestedMulti[3].toLowerCase() === "kg" ? unitAmount * 1000 : unitAmount;
    return { totalGrams: units * unitGrams, unitGrams, units };
  }

  const multi = normalized.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*g/i);
  if (multi) {
    const units = parseNumber(multi[1]);
    const unitGrams = parseNumber(multi[2]);
    return { totalGrams: units * unitGrams, unitGrams, units };
  }

  const parenthesized = [...normalized.matchAll(/\((\d+(?:[.,]\d+)?)\s*(kg|g)\)/gi)];
  if (parenthesized.length) {
    const best = parenthesized[0];
    const amount = parseNumber(best[1]);
    const totalGrams = best[2].toLowerCase() === "kg" ? amount * 1000 : amount;
    return { totalGrams, unitGrams: totalGrams, units: 1 };
  }

  const singleCandidates = [...normalized.matchAll(/(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(kg|g)\b/gi)]
    .filter((match) => {
      const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 24);
      return !/^\s*(?:protein|proteiner|kreatin|creatine)\b/i.test(after);
    });

  const single = singleCandidates[0];
  if (!single) return null;

  const amount = parseNumber(single[1]);
  const totalGrams = single[2].toLowerCase() === "kg" ? amount * 1000 : amount;
  return { totalGrams, unitGrams: totalGrams, units: 1 };
}

function parseGrams(text) {
  const match = text.replace(/\u00a0/g, " ").match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  return match ? parseNumber(match[1]) : null;
}

function parseTableColumnGrams(text) {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(/(?:per|pr\.?)\s*(\d+(?:[.,]\d+)?)\s*g/i);
  return match ? parseNumber(match[1]) : null;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) < 0.01;
}

function proteinForColumn(valueGrams, columnGrams, packageInfo) {
  if (!valueGrams || !columnGrams || !packageInfo) return valueGrams;
  if (nearlyEqual(columnGrams, packageInfo.totalGrams)) return valueGrams;
  if (nearlyEqual(columnGrams, packageInfo.unitGrams)) return valueGrams * packageInfo.units;
  if (nearlyEqual(columnGrams, 100)) return (valueGrams / 100) * packageInfo.totalGrams;
  return valueGrams;
}

function parseProteinGrams(text, packageInfo = null) {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const servingUnit = String.raw`(?:\d+(?:[.,]\d+)?\s*g\s*)?(?:bar|vaffel|flaske|stk)`;
  const servingWithGramsMatches = [
    ...normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*g\s*(?:protein|proteiner)\s*(?:pr\.?|per)\s*(\d+(?:[.,]\d+)?)\s*g\s*(?:portion|servering|serving|shake|scoop)/gi),
    ...normalized.matchAll(/(?:protein|proteiner)\D{0,20}(\d+(?:[.,]\d+)?)\s*g\s*(?:pr\.?|per)\s*(\d+(?:[.,]\d+)?)\s*g\s*(?:portion|servering|serving|shake|scoop)/gi)
  ];

  for (const match of servingWithGramsMatches) {
    const proteinGrams = parseNumber(match[1]);
    const servingGrams = parseNumber(match[2]);
    if (proteinGrams > 0 && proteinGrams <= 200 && servingGrams > 0 && packageInfo?.totalGrams) {
      return (proteinGrams / servingGrams) * packageInfo.totalGrams;
    }
  }

  const servingMatches = [
    ...normalized.matchAll(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*g\s*(?:protein|proteiner)\s*(?:pr\.?|per)\s*${servingUnit}`, "gi")),
    ...normalized.matchAll(new RegExp(String.raw`(?:protein|proteiner)\D{0,20}(\d+(?:[.,]\d+)?)\s*g\s*(?:pr\.?|per)\s*${servingUnit}`, "gi")),
    ...normalized.matchAll(new RegExp(String.raw`(?:pr\.?|per)\s*${servingUnit}\D{0,20}(\d+(?:[.,]\d+)?)\s*g\s*(?:protein|proteiner)`, "gi"))
  ];

  const plausibleServing = servingMatches
    .map((match) => parseNumber(match[1]))
    .find((grams) => grams > 0 && grams <= 200);

  if (plausibleServing) return packageInfo ? plausibleServing * packageInfo.units : plausibleServing;

  const percentMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:protein|proteiner)\b/i);
  if (percentMatch && packageInfo?.totalGrams) {
    const percent = parseNumber(percentMatch[1]);
    if (percent > 0 && percent <= 100) return packageInfo.totalGrams * (percent / 100);
  }

  const explicitTotalMatches = [
    ...normalized.matchAll(/(?:med|indeholder|har|with)\D{0,24}(\d+(?:[.,]\d+)?)\s*g\s*(?:protein|proteiner)\b(?!\s*(?:pr\.?|per)\s*100)/gi),
    ...normalized.matchAll(/(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*g\s*(?:protein|proteiner)\b(?!\s*(?:pr\.?|per)\s*100)/gi)
  ];

  const explicitTotal = explicitTotalMatches
    .map((match) => parseNumber(match[1]))
    .find((grams) => grams > 0 && grams <= 200);

  if (!explicitTotal) return null;
  if (packageInfo?.unitGrams > 200) return null;
  return packageInfo ? explicitTotal * packageInfo.units : explicitTotal;
}

function extractFirst(html, pattern) {
  return html.match(pattern)?.[1] || "";
}

function extractSections(html, includeNutrition = true) {
  const overviewPatterns = [
    /<div class="product-overview">([\s\S]*?)<\/div>/i,
    /<div class="tab-pane fade show active description"[\s\S]*?>([\s\S]*?)<\/div>\s*<div class="tab-pane fade toc"/i
  ];
  const nutritionPatterns = [
    /<div class="tab-pane fade toc"[\s\S]*?>([\s\S]*?)<\/div>\s*<div class="tab-pane fade reviews"/i
  ];
  const sections = [];
  for (const pattern of includeNutrition ? [...overviewPatterns, ...nutritionPatterns] : overviewPatterns) {
    const match = html.match(pattern);
    if (match) sections.push(stripTags(match[1]));
  }
  return sections.join(" ");
}

function parseProteinFromTables(html, packageInfo) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((match) => stripTags(match[1]))
      .slice(0, 4);
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => stripTags(match[2]));
      const label = cells[0]?.toLowerCase();
      if (label !== "protein" && label !== "proteiner") continue;

      const candidates = cells.slice(1)
        .map((cell, index) => {
          const valueGrams = parseGrams(cell);
          if (!valueGrams) return null;
          const headerIndex = headers.length === cells.length - 1 ? index : index + 1;
          const columnGrams = parseTableColumnGrams(headers[headerIndex] || "");
          return {
            valueGrams,
            columnGrams,
            totalProtein: proteinForColumn(valueGrams, columnGrams, packageInfo)
          };
        })
        .filter(Boolean);

      if (!candidates.length) return null;

      const exactPackage = candidates.find((candidate) =>
        candidate.columnGrams && packageInfo && nearlyEqual(candidate.columnGrams, packageInfo.totalGrams)
      );
      if (exactPackage) return exactPackage.totalProtein;

      const exactUnit = candidates.find((candidate) =>
        candidate.columnGrams && packageInfo && nearlyEqual(candidate.columnGrams, packageInfo.unitGrams)
      );
      if (exactUnit) return exactUnit.totalProtein;

      const per100 = candidates.find((candidate) => candidate.columnGrams && nearlyEqual(candidate.columnGrams, 100));
      if (per100) return per100.totalProtein;

      return candidates.at(-1).totalProtein;
    }
  }
  return null;
}

function parseProduct(html) {
  const title = stripTags(extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
  const scopedText = `${title} ${extractSections(html)}`;
  const explicitText = `${title} ${extractSections(html, false)}`;
  const packageInfo = parsePackageInfo(title) || parsePackageInfo(scopedText) || parsePackageInfo(stripTags(html));
  const proteinGrams = parseProteinGrams(explicitText, packageInfo) || parseProteinFromTables(html, packageInfo);
  const price = Number(extractFirst(html, /"price":\s*"(\d+(?:\.\d+)?)"/i)) || null;
  return { title, packageInfo, proteinGrams, price, ratio: price ? proteinGrams / price : null };
}

for (const product of cases) {
  test(product.name, async () => {
    const response = await fetch(product.url);
    assert.equal(response.ok, true, `${product.url} returned ${response.status}`);
    const html = await response.text();
    const parsed = parseProduct(html);
    const [min, max] = product.expectedProtein;
    assert.ok(parsed.proteinGrams >= min && parsed.proteinGrams <= max, `${product.name}: got ${parsed.proteinGrams}g protein, expected ${min}-${max}g`);
  });
}
