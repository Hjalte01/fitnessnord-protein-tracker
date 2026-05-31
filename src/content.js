const BADGE_CLASS = "fn-protein-ratio";
const PROCESSED_ATTR = "data-fn-protein-processed";
const CACHE_PREFIX = "fn-protein:v11:";
const PANEL_ID = "fn-protein-panel";
const HIGHLIGHT_CLASS = "fn-protein-highlight";
const HIDDEN_CLASS = "fn-protein-hidden";
const ENABLED_STORAGE_KEY = "enabled";
const PRODUCT_LINK_SELECTOR = ".item-title a[href], .item-img a[href]";
const PRODUCT_CARD_SELECTOR = ".product, .item[data-productid], .item";
const productResults = new Map();
let panelOpen = false;
let hideBelowThreshold = true;
let hideSoldOut = true;
let sortByRatio = true;
let listSearch = "";
let renderQueued = false;
let nextOriginalIndex = 0;
let isReordering = false;
let calculatingAll = false;
let observer = null;

function parseDkk(text) {
  const match = text.replace(/\s+/g, " ").match(/(\d+(?:[.,]\d{1,2})?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function parseNumber(value) {
  return Number(value.replace(",", "."));
}

function amountToGrams(amount, unit) {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit === "kg") return amount * 1000;
  if (normalizedUnit === "l" || normalizedUnit === "liter") return amount * 1000;
  return amount;
}

function parsePackageInfo(text) {
  const normalized = text.replace(/\s+/g, " ");
  const caseNested = normalized.match(/(?:case|kasse|box)\D{0,40}(\d+)\s*x\D{0,80}\(\s*(?:\d+\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|liter)\s*\)/i);
  if (caseNested) {
    const units = parseNumber(caseNested[1]);
    const unitAmount = parseNumber(caseNested[2]);
    const unitGrams = amountToGrams(unitAmount, caseNested[3]);
    return {
      totalGrams: units * unitGrams,
      unitGrams,
      units
    };
  }

  const nestedMulti = normalized.match(/(\d+)\s*x\D{0,80}\(\s*(?:\d+\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|liter)\s*\)/i);
  if (nestedMulti) {
    const units = parseNumber(nestedMulti[1]);
    const unitAmount = parseNumber(nestedMulti[2]);
    const unitGrams = amountToGrams(unitAmount, nestedMulti[3]);
    return {
      totalGrams: units * unitGrams,
      unitGrams,
      units
    };
  }

  const multi = normalized.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  if (multi) {
    const units = parseNumber(multi[1]);
    const unitGrams = amountToGrams(parseNumber(multi[2]), multi[3]);
    return {
      totalGrams: units * unitGrams,
      unitGrams,
      units
    };
  }

  const parenthesized = [...normalized.matchAll(/\((\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|liter)\)/gi)];
  if (parenthesized.length) {
    const best = parenthesized[0];
    const amount = parseNumber(best[1]);
    const totalGrams = amountToGrams(amount, best[2]);
    return {
      totalGrams,
      unitGrams: totalGrams,
      units: 1
    };
  }

  const singleCandidates = [...normalized.matchAll(/(?:^|[^\d])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|liter)\b/gi)]
    .filter((match) => {
      const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 24);
      return !/^\s*(?:protein|proteiner|kreatin|creatine)\b/i.test(after);
    });

  const single = singleCandidates[0];
  if (!single) return null;

  const amount = parseNumber(single[1]);
  const totalGrams = amountToGrams(amount, single[2]);
  return {
    totalGrams,
    unitGrams: totalGrams,
    units: 1
  };
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

function normalizeVariantName(value) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:flavor|flavour|smag|smagsvariant|choose|option|vælg|venligst|dkk)\b/g, " ")
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/[^a-zæøå0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variantMatches(name, hints) {
  const normalizedName = normalizeVariantName(name);
  if (!normalizedName) return false;

  return hints
    .map(normalizeVariantName)
    .filter(Boolean)
    .some((hint) => normalizedName.includes(hint) || hint.includes(normalizedName));
}

function parseVariantProteinFromText(text, packageInfo, variantHints = []) {
  if (!packageInfo?.totalGrams) return null;

  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const blocks = [...normalized.matchAll(/\(([^)]*(?:flavor|flavour|smag)[^)]*)\)(.*?)(?=\([^)]*(?:flavor|flavour|smag)[^)]*\)|$)/gi)]
    .map((match) => {
      const proteinMatch = match[2].match(/(?:protein|proteiner)\s*(\d+(?:[.,]\d+)?)\s*g/i);
      if (!proteinMatch) return null;

      return {
        name: match[1],
        totalProtein: proteinForColumn(parseNumber(proteinMatch[1]), 100, packageInfo)
      };
    })
    .filter(Boolean);

  if (!blocks.length) return null;

  const hinted = blocks.find((block) => variantMatches(block.name, variantHints));
  if (hinted) return hinted.totalProtein;

  return Math.max(...blocks.map((block) => block.totalProtein));
}

function parseProteinFromTables(doc, packageInfo) {
  const tables = doc.querySelectorAll("table");

  for (const table of tables) {
    const headers = [...table.querySelectorAll("thead th")].map((header) => header.textContent || "");
    const rows = table.querySelectorAll("tbody tr, tr");

    for (const row of rows) {
      const cells = [...row.children];
      const label = cells[0]?.textContent?.replace(/\s+/g, " ").trim().toLowerCase();
      if (label !== "protein" && label !== "proteiner") continue;

      const valueCells = cells.slice(1);
      const candidates = valueCells
        .map((cell, index) => {
          const valueGrams = parseGrams(cell.textContent || "");
          if (!valueGrams) return null;

          const headerIndex = headers.length === valueCells.length ? index : index + 1;
          const header = headers[headerIndex] || "";
          const columnGrams = parseTableColumnGrams(header);
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

      return candidates[candidates.length - 1].totalProtein;
    }
  }

  return null;
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

  if (plausibleServing) {
    return packageInfo ? plausibleServing * packageInfo.units : plausibleServing;
  }

  const percentMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:protein|proteiner)\b/i);
  if (percentMatch && packageInfo?.totalGrams) {
    const percent = parseNumber(percentMatch[1]);
    if (percent > 0 && percent <= 100) {
      return packageInfo.totalGrams * (percent / 100);
    }
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

function findProductLink(product) {
  return product.querySelector(PRODUCT_LINK_SELECTOR);
}

function findProductTitle(product) {
  return product.querySelector(".item-title a")?.textContent?.replace(/\s+/g, " ").trim()
    || product.querySelector("img[alt]")?.getAttribute("alt")
    || "Ukendt produkt";
}

function findProductCard(product) {
  return product.closest(".product") || product.closest(".item[data-productid]") || product;
}

function findPriceNode(product) {
  return product.querySelector(".item-price .price");
}

function extractOptionLabel(option) {
  return option.textContent
    ?.replace(/\s*-\s*\d+(?:[.,]\d+)?\s*(?:DKK|kr\.?)?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || "";
}

function isPlaceholderOption(text) {
  return /^(?:-|choose an option|vælg|vaelg|smagsvariant|flavor|smag)$/i.test(text.trim());
}

function findVariantHints(product) {
  const hints = [];

  product.querySelectorAll(".item-properties select, select.product-card-attributes").forEach((select) => {
    const selected = [...select.selectedOptions]
      .map(extractOptionLabel)
      .filter((label) => label && !isPlaceholderOption(label));
    if (selected.length) {
      hints.push(...selected);
      return;
    }

    hints.push(...[...select.options]
      .map(extractOptionLabel)
      .filter((label) => label && !isPlaceholderOption(label)));
  });

  const scriptText = [...product.querySelectorAll(".eval_script, script")]
    .map((node) => node.textContent || "")
    .join(" ");
  hints.push(...extractVariantHintsFromConfig(scriptText));

  return [...new Set(hints.map(normalizeVariantName).filter(Boolean))];
}

function isSoldOutProduct(product) {
  const text = product.textContent?.replace(/\s+/g, " ").toLowerCase() || "";
  if (/\b(udsolgt|ikke på lager|ikke paa lager|out of stock|sold out)\b/i.test(text)) return true;

  return Boolean(product.querySelector(
    ".out-of-stock, .sold-out, .stock.unavailable, .availability.out-of-stock, [class*='out-of-stock'], [class*='sold-out']"
  ));
}

function extractVariantHintsFromConfig(text) {
  return [...text.matchAll(/"label"\s*:\s*"([^"]+)"/gi)]
    .map((match) => match[1].replace(/\\u00a0/g, " "))
    .map((label) => label.replace(/\s*-\s*\d+(?:[.,]\d+)?\s*(?:DKK|kr\.?)?.*$/i, "").trim())
    .filter((label) => label && !isPlaceholderOption(label));
}

function variantCachePart(variantHints = []) {
  return variantHints.length ? `:${variantHints.join("|")}` : "";
}

function cacheKey(url, variantHints = []) {
  return `${CACHE_PREFIX}${url}${variantCachePart(variantHints)}`;
}

function readCache(url, variantHints = []) {
  const raw = sessionStorage.getItem(cacheKey(url, variantHints));
  if (!raw) return null;

  try {
    const cached = JSON.parse(raw);
    if (Date.now() - cached.createdAt < 1000 * 60 * 60) return cached.proteinGrams;
  } catch (_) {
    sessionStorage.removeItem(cacheKey(url));
  }

  return null;
}

function writeCache(url, proteinGrams, variantHints = []) {
  sessionStorage.setItem(cacheKey(url, variantHints), JSON.stringify({
    createdAt: Date.now(),
    proteinGrams
  }));
}

async function fetchProteinGrams(url, fallbackText, variantHints = []) {
  const cached = readCache(url, variantHints);
  if (cached !== null) return cached;

  const fallbackPackageInfo = parsePackageInfo(fallbackText);
  const fallbackProtein = parseProteinGrams(fallbackText, fallbackPackageInfo);
  if (fallbackProtein) {
    writeCache(url, fallbackProtein, variantHints);
    return fallbackProtein;
  }

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const pageText = doc.body?.innerText || doc.body?.textContent || "";
  const productTitle = doc.querySelector("h1, .product-name, .product-shop")?.textContent || "";
  const scopedText = [
    productTitle,
    ...doc.querySelectorAll(".product-overview, #description, #toc, .product-description")
  ].map((node) => node.textContent || "").join(" ");
  const explicitText = [
    productTitle,
    ...doc.querySelectorAll(".product-overview, #description")
  ].map((node) => node.textContent || "").join(" ");
  const packageInfo = parsePackageInfo(productTitle)
    || parsePackageInfo(fallbackText)
    || parsePackageInfo(scopedText)
    || parsePackageInfo(pageText);
  const availableVariantHints = variantHints.length
    ? variantHints
    : extractVariantHintsFromConfig(pageText);
  const explicitProtein = parseProteinGrams(`${productTitle} ${fallbackText} ${explicitText}`, packageInfo);
  const variantProtein = parseVariantProteinFromText(scopedText || pageText, packageInfo, availableVariantHints);
  const proteinGrams = explicitProtein || variantProtein || parseProteinFromTables(doc, packageInfo);

  if (proteinGrams) writeCache(url, proteinGrams, variantHints);
  return proteinGrams;
}

function upsertBadge(product, text, state = "ready") {
  const priceNode = findPriceNode(product);
  if (!priceNode) return;

  let badge = priceNode.querySelector(`.${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    priceNode.append(" ");
    priceNode.append(badge);
  }

  badge.dataset.state = state;
  badge.textContent = text;
}

function formatRatio(ratio) {
  return `${ratio.toFixed(2).replace(".", ",")} p/DKK`;
}

function getThreshold() {
  const input = document.querySelector("#fn-protein-threshold");
  const value = parseNumber(input?.value || "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function queueRenderPanel() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPanel();
    applyPageFilter();
    applySort();
  });
}

function setProductResult(product, patch) {
  const link = findProductLink(product);
  if (!link) return;
  const card = findProductCard(product);
  const soldOut = isSoldOutProduct(card);

  const existing = productResults.get(link.href) || {
    url: link.href,
    title: findProductTitle(product),
    product,
    card,
    originalIndex: nextOriginalIndex++
  };

  productResults.set(link.href, {
    ...existing,
    ...patch,
    product,
    card,
    soldOut,
    title: findProductTitle(product)
  });

  queueRenderPanel();
}

async function annotateProduct(product) {
  if (product.getAttribute(PROCESSED_ATTR) === "true") return;
  product.setAttribute(PROCESSED_ATTR, "true");

  const link = findProductLink(product);
  const priceNode = findPriceNode(product);
  if (!link || !priceNode) return;

  const price = parseDkk(priceNode.textContent || "");
  if (!price) return;
  const variantHints = findVariantHints(product);
  attachVariantChangeListeners(product);

  setProductResult(product, { price, status: "loading" });
  upsertBadge(product, "beregner...", "loading");

  try {
    const proteinGrams = await fetchProteinGrams(link.href, product.textContent || "", variantHints);
    if (!proteinGrams) {
      setProductResult(product, { price, proteinGrams: null, ratio: null, status: "unknown" });
      upsertBadge(product, "protein ukendt", "unknown");
      return;
    }

    const ratio = proteinGrams / price;
    setProductResult(product, { price, proteinGrams, ratio, status: "ready" });
    upsertBadge(product, `(${formatRatio(ratio)})`);
  } catch (error) {
    console.debug("[FitnessNord Protein Tracker]", error);
    setProductResult(product, { price, proteinGrams: null, ratio: null, status: "unknown" });
    upsertBadge(product, "protein ukendt", "unknown");
  }
}

function attachVariantChangeListeners(product) {
  product.querySelectorAll(".item-properties select, select.product-card-attributes").forEach((select) => {
    if (select.dataset.fnProteinVariantListener === "true") return;
    select.dataset.fnProteinVariantListener = "true";
    select.addEventListener("change", () => {
      product.removeAttribute(PROCESSED_ATTR);
      annotateProduct(product);
    });
  });
}

function getProductCards() {
  const cards = new Set();

  document.querySelectorAll(PRODUCT_CARD_SELECTOR).forEach((candidate) => {
    const card = findProductCard(candidate);
    if (findProductLink(card) && findPriceNode(card)) cards.add(card);
  });

  return [...cards];
}

function scanProducts() {
  const cards = getProductCards();
  if (cards.length) createPanel();
  cards.forEach(annotateProduct);
  queueRenderPanel();
}

function productsSortedByRatio() {
  const threshold = getThreshold();
  return [...productResults.values()]
    .filter((result) =>
      result.status === "ready"
      && result.ratio >= threshold
      && (!hideSoldOut || !result.soldOut)
    )
    .sort((left, right) => right.ratio - left.ratio);
}

function scrollToResult(result) {
  const card = resolveResultCard(result);
  if (!card) return;

  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => {
    element.classList.remove(HIGHLIGHT_CLASS);
  });

  card.classList.remove(HIDDEN_CLASS);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => card.classList.remove(HIGHLIGHT_CLASS), 2200);
}

function applyPageFilter() {
  const threshold = getThreshold();

  for (const result of productResults.values()) {
    const card = resolveResultCard(result);
    if (!card) continue;
    const shouldHide = (hideSoldOut && result.soldOut)
      || (hideBelowThreshold && (result.status !== "ready" || result.ratio < threshold));

    card.classList.toggle(HIDDEN_CLASS, shouldHide);
  }
}

function resolveResultCard(result) {
  if (result.card?.isConnected) {
    const normalizedCard = findProductCard(result.card);
    if (normalizedCard !== result.card) {
      productResults.set(result.url, {
        ...result,
        card: normalizedCard,
        soldOut: isSoldOutProduct(normalizedCard)
      });
    }

    return normalizedCard;
  }

  const link = [...document.querySelectorAll(PRODUCT_LINK_SELECTOR)]
    .find((candidate) => candidate.href === result.url);
  if (!link) return result.card || null;

  const card = findProductCard(link);
  if (!card) return result.card || null;

  productResults.set(result.url, {
    ...result,
    card,
    soldOut: isSoldOutProduct(card)
  });

  return card;
}

function findSortContainer(card) {
  const selectors = [
    ".category-products-grid",
    ".products-grid",
    ".products-list",
    ".product-grid",
    ".products.wrapper",
    ".row"
  ];

  for (const selector of selectors) {
    const container = card.closest(selector);
    if (container) return container;
  }

  return card.parentElement;
}

function directChildOf(container, element) {
  let child = element;
  while (child?.parentElement && child.parentElement !== container) {
    child = child.parentElement;
  }

  return child?.parentElement === container ? child : element;
}

function getUnifiedSortContainer(card) {
  const category = card.closest(".category-products");
  const grid = category?.querySelector(".products-grid-for-inf-scroll")
    || document.querySelector(".products-grid-for-inf-scroll");

  return grid || findSortContainer(card);
}

function getSortableResults() {
  return [...productResults.values()]
    .map((result) => ({
      ...result,
      card: resolveResultCard(result)
    }))
    .filter((result) => result.card?.parentElement)
    .filter((result) => !hideSoldOut || !result.soldOut)
    .sort((left, right) => {
      if (left.status === "ready" && right.status !== "ready") return -1;
      if (left.status !== "ready" && right.status === "ready") return 1;
      if (left.status === "ready" && right.status === "ready") return right.ratio - left.ratio;
      return (left.originalIndex || 0) - (right.originalIndex || 0);
    });
}

function applySort() {
  if (!sortByRatio || calculatingAll) return;

  const groups = new Map();
  for (const result of getSortableResults()) {
    const container = getUnifiedSortContainer(result.card);
    if (!container) continue;

    const movable = result.card.matches(".product, .item[data-productid]")
      ? result.card
      : directChildOf(container, result.card);
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push({ ...result, movable });
  }

  for (const [container, results] of groups) {
    const current = [...container.children].filter((child) => results.some((result) => result.movable === child));
    const alreadySorted = results.every((result, index) => current[index] === result.movable);
    if (alreadySorted) continue;

    isReordering = true;
    results.forEach((result) => container.append(result.movable));
  }

  if (isReordering) queueMicrotask(() => { isReordering = false; });
}

function restoreOriginalOrder() {
  const groups = new Map();
  for (const result of productResults.values()) {
    const card = resolveResultCard(result);
    if (!card) continue;

    const container = getUnifiedSortContainer(card);
    if (!container) continue;

    const movable = card.matches(".product, .item[data-productid]")
      ? card
      : directChildOf(container, card);
    if (!groups.has(container)) groups.set(container, []);
    groups.get(container).push({ ...result, card, movable });
  }

  for (const [container, results] of groups) {
    const ordered = results
      .sort((left, right) => (left.originalIndex || 0) - (right.originalIndex || 0))
      .map((result) => result.movable);
    const current = [...container.children].filter((child) => ordered.includes(child));
    const alreadyRestored = ordered.every((card, index) => current[index] === card);
    if (alreadyRestored) continue;

    isReordering = true;
    ordered.forEach((card) => container.append(card));
  }

  if (isReordering) queueMicrotask(() => { isReordering = false; });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productUrlSet() {
  return new Set([...document.querySelectorAll(PRODUCT_LINK_SELECTOR)].map((link) => link.href));
}

function collectPaginationUrls(root = document) {
  const urls = new Map();
  const current = new URL(window.location.href);

  root.querySelectorAll(".pager a[href], .toolbar a[href]").forEach((link) => {
    const url = new URL(link.href, window.location.href);
    if (url.origin !== current.origin || url.pathname !== current.pathname) return;
    if (!url.searchParams.has("p")) return;
    urls.set(url.href, url.href);
  });

  urls.delete(current.href);
  return [...urls.values()];
}

function findProductGrid(root = document) {
  return root.querySelector(".products-grid-for-inf-scroll")
    || root.querySelector(".category-products .products-grid")
    || root.querySelector(".products-grid");
}

function extractProductCardsFromDoc(doc) {
  const grid = findProductGrid(doc);
  if (!grid) return [];

  return [...grid.children].filter((child) =>
    child.matches(".product, .item[data-productid]")
    && findProductLink(child)
    && findPriceNode(child)
  );
}

async function loadAllPagedProducts() {
  const targetGrid = findProductGrid(document);
  if (!targetGrid) return false;

  const pending = collectPaginationUrls();
  if (!pending.length) return false;

  const seenPages = new Set([window.location.href]);
  const seenProducts = productUrlSet();
  let appended = 0;

  while (pending.length) {
    const url = pending.shift();
    if (seenPages.has(url)) continue;
    seenPages.add(url);

    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) continue;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    collectPaginationUrls(doc).forEach((nextUrl) => {
      if (!seenPages.has(nextUrl) && !pending.includes(nextUrl)) pending.push(nextUrl);
    });

    for (const card of extractProductCardsFromDoc(doc)) {
      const link = findProductLink(card);
      if (!link || seenProducts.has(link.href)) continue;

      seenProducts.add(link.href);
      targetGrid.append(card);
      appended += 1;
    }
  }

  if (appended) scanProducts();
  return appended > 0;
}

async function loadAllVisibleProducts() {
  if (await loadAllPagedProducts()) return { usedScrollFallback: false };

  let stableRounds = 0;
  let rounds = 0;
  let lastCount = getProductCards().length;
  let lastHeight = document.documentElement.scrollHeight;

  while (stableRounds < 1 && rounds < 40) {
    rounds += 1;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    await delay(650);
    scanProducts();

    const count = getProductCards().length;
    const height = document.documentElement.scrollHeight;
    if (count === lastCount && height === lastHeight) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      lastCount = count;
      lastHeight = height;
    }
  }

  return { usedScrollFallback: true };
}

async function calculateAllProducts() {
  if (calculatingAll) return;
  calculatingAll = true;
  const calculateButton = document.querySelector("[data-role='calculate']");
  const originalText = calculateButton?.textContent || "Beregn alle";

  if (calculateButton) {
    calculateButton.textContent = "Indlæser...";
    calculateButton.disabled = true;
  }

  try {
    const loadResult = await loadAllVisibleProducts();
    getProductCards().forEach((product) => {
      if (product.getAttribute(PROCESSED_ATTR) !== "true") annotateProduct(product);
    });
    scanProducts();
    if (loadResult.usedScrollFallback) window.scrollTo({ top: 0, behavior: "auto" });
  } finally {
    calculatingAll = false;
    if (sortByRatio) applySort();

    if (calculateButton) {
      calculateButton.textContent = originalText;
      calculateButton.disabled = false;
    }
  }
}

function renderPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const ready = [...productResults.values()].filter((result) => result.status === "ready").length;
  const loading = [...productResults.values()].filter((result) => result.status === "loading").length;
  const unknown = [...productResults.values()].filter((result) => result.status === "unknown").length;
  const soldOut = [...productResults.values()].filter((result) => result.soldOut).length;
  const ranked = productsSortedByRatio();
  const visibleRanked = listSearch
    ? ranked.filter((result) => result.title.toLowerCase().includes(listSearch))
    : ranked;
  const best = ranked[0] || null;

  panel.querySelector("[data-role='summary']").textContent = best
    ? `Bedst: ${formatRatio(best.ratio)}`
    : "Ingen kendte ratios endnu";

  panel.querySelector("[data-role='counts']").textContent =
    `${ready} klar · ${loading} beregner · ${unknown} ukendt · ${soldOut} udsolgt`;

  const list = panel.querySelector("[data-role='list']");
  list.textContent = "";

  if (!visibleRanked.length) {
    const empty = document.createElement("div");
    empty.className = "fn-protein-empty";
    empty.textContent = listSearch
      ? "Ingen produkter matcher søgningen."
      : "Ingen kendte produkter matcher grænsen.";
    list.append(empty);
    return;
  }

  visibleRanked.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fn-protein-result";
    button.title = result.title;
    button.addEventListener("click", () => scrollToResult(result));

    const rank = document.createElement("span");
    rank.className = "fn-protein-rank";
    rank.textContent = `${ranked.indexOf(result) + 1}`;

    const title = document.createElement("span");
    title.className = "fn-protein-result-title";
    title.textContent = result.title;

    const ratio = document.createElement("span");
    ratio.className = "fn-protein-result-ratio";
    ratio.textContent = formatRatio(result.ratio);

    button.append(rank, title, ratio);
    list.append(button);
  });
}

function updatePanelOffset() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const header = document.querySelector(".site-header");
  const headerRect = header?.getBoundingClientRect();
  const offset = headerRect && headerRect.bottom > 0 && headerRect.top <= 8
    ? headerRect.bottom + 8
    : 8;

  panel.style.setProperty("--fn-protein-sticky-top", `${Math.round(offset)}px`);
}

function createPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.className = "fn-protein-panel";
  panel.innerHTML = `
    <button type="button" class="fn-protein-toggle" data-role="toggle" aria-expanded="false">
      Protein
    </button>
    <div class="fn-protein-panel-body" data-role="body" hidden>
      <div class="fn-protein-panel-head">
        <strong data-role="summary">Ingen kendte ratios endnu</strong>
        <span data-role="counts">0 klar · 0 beregner · 0 ukendt</span>
      </div>
      <div class="fn-protein-controls">
        <button type="button" data-role="calculate">Beregn alle</button>
        <button type="button" data-role="best">Gå til bedst</button>
      </div>
      <label class="fn-protein-threshold">
        Min. p/DKK
        <input id="fn-protein-threshold" type="number" min="0" step="0.1" inputmode="decimal" value="0">
      </label>
      <label class="fn-protein-check">
        <input type="checkbox" data-role="hide-below" checked>
        Skjul under grænse og ukendt
      </label>
      <label class="fn-protein-check">
        <input type="checkbox" data-role="hide-sold-out" checked>
        Skjul udsolgt
      </label>
      <label class="fn-protein-check">
        <input type="checkbox" data-role="sort-by-ratio" checked>
        Sorter siden efter p/DKK
      </label>
      <label class="fn-protein-search">
        Søg i listen
        <input type="search" data-role="search" placeholder="fx blueberry">
      </label>
      <div class="fn-protein-list" data-role="list"></div>
    </div>
  `;

  panel.querySelector("[data-role='toggle']").addEventListener("click", () => {
    panelOpen = !panelOpen;
    panel.querySelector("[data-role='body']").hidden = !panelOpen;
    panel.querySelector("[data-role='toggle']").setAttribute("aria-expanded", String(panelOpen));
  });

  panel.querySelector("[data-role='calculate']").addEventListener("click", calculateAllProducts);
  panel.querySelector("[data-role='best']").addEventListener("click", () => {
    const best = productsSortedByRatio()[0];
    if (best) scrollToResult(best);
  });

  panel.querySelector("#fn-protein-threshold").addEventListener("input", queueRenderPanel);
  panel.querySelector("[data-role='search']").addEventListener("input", (event) => {
    listSearch = event.currentTarget.value.trim().toLowerCase();
    queueRenderPanel();
  });
  panel.querySelector("[data-role='hide-below']").addEventListener("change", (event) => {
    hideBelowThreshold = event.currentTarget.checked;
    applyPageFilter();
  });
  panel.querySelector("[data-role='hide-sold-out']").addEventListener("change", (event) => {
    hideSoldOut = event.currentTarget.checked;
    queueRenderPanel();
  });
  panel.querySelector("[data-role='sort-by-ratio']").addEventListener("change", (event) => {
    sortByRatio = event.currentTarget.checked;
    if (sortByRatio) {
      applySort();
    } else {
      restoreOriginalOrder();
    }
  });

  const header = document.querySelector(".site-header");
  if (header?.parentNode) {
    header.insertAdjacentElement("afterend", panel);
  } else {
    document.body.prepend(panel);
  }
  updatePanelOffset();
  window.addEventListener("resize", updatePanelOffset);
  window.addEventListener("scroll", updatePanelOffset, { passive: true });
  renderPanel();
}

function removeProteinUi() {
  restoreOriginalOrder();
  document.getElementById(PANEL_ID)?.remove();
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => {
    element.classList.remove(HIGHLIGHT_CLASS);
  });
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => {
    element.classList.remove(HIDDEN_CLASS);
  });
  document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((element) => {
    element.removeAttribute(PROCESSED_ATTR);
  });
}

function resetState() {
  panelOpen = false;
  hideBelowThreshold = true;
  hideSoldOut = true;
  sortByRatio = true;
  listSearch = "";
  renderQueued = false;
  nextOriginalIndex = 0;
  isReordering = false;
  calculatingAll = false;
  productResults.clear();
}

function startExtension() {
  if (observer) return;

  scanProducts();
  observer = new MutationObserver(() => {
    if (!isReordering) scanProducts();
  });
  observer.observe(document.querySelector("main#content") || document.body, { childList: true, subtree: true });
}

function stopExtension() {
  observer?.disconnect();
  observer = null;
  removeProteinUi();
  resetState();
}

async function readEnabledSetting() {
  try {
    const stored = await browser.storage.local.get(ENABLED_STORAGE_KEY);
    return stored[ENABLED_STORAGE_KEY] !== false;
  } catch (_) {
    return true;
  }
}

async function initExtension() {
  if (await readEnabledSetting()) startExtension();

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[ENABLED_STORAGE_KEY]) return;

    if (changes[ENABLED_STORAGE_KEY].newValue === false) {
      stopExtension();
    } else {
      startExtension();
    }
  });
}

initExtension();
