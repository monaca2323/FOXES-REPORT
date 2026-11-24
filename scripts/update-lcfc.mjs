import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = path.resolve('data/lcfc.json');

const RSS_SOURCES = [
  {
    name: 'BBC Sport Leicester',
    tag: 'BBC SPORT',
    url: 'https://feeds.bbci.co.uk/sport/football/teams/leicester-city/rss.xml',
    strictTeamFeed: true
  },
  {
    name: 'Leicestershire Live',
    tag: 'LEICESTERSHIRE LIVE',
    url: 'https://www.leicestermercury.co.uk/sport/football/football-news/?service=rss',
    strictTeamFeed: false
  },
  {
    name: 'Yorkshire Post',
    tag: 'YORKSHIRE POST',
    url: 'https://www.yorkshirepost.co.uk/sport/football/rss',
    strictTeamFeed: false
  }
];

const LCFC_KEYWORDS = [
  'leicester city',
  'leicester',
  'lcfc',
  'foxes',
  'king power'
];

function decodeXmlEntities(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLeicesterOnly(title, description, strictTeamFeed) {
  if (strictTeamFeed) return true;
  const text = `${title} ${description}`.toLowerCase();
  return LCFC_KEYWORDS.some(kw => text.includes(kw));
}

function formatDateYmd(pubDateStr) {
  const parsed = Date.parse(pubDateStr || '');
  if (Number.isNaN(parsed)) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseRssItems(xmlText, sourceMeta) {
  const itemMatches = xmlText.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const results = [];

  for (const rawItem of itemMatches) {
    const titleMatch = rawItem.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = rawItem.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = rawItem.match(/<description>([\s\S]*?)<\/description>/i);
    const dateMatch = rawItem.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = decodeXmlEntities(titleMatch?.[1] || '');
    const sourceUrl = decodeXmlEntities(linkMatch?.[1] || '');
    const summary = decodeXmlEntities(descMatch?.[1] || '');
    const date = formatDateYmd(decodeXmlEntities(dateMatch?.[1] || ''));

    if (!title || !sourceUrl) continue;
    if (!isLeicesterOnly(title, summary, sourceMeta.strictTeamFeed)) continue;

    const id = `rss-${Buffer.from(sourceUrl).toString('base64url').slice(0, 20)}`;
    results.push({
      id,
      tag: sourceMeta.tag,
      date,
      source: `${sourceMeta.name} / LCFC`,
      sourceUrl,
      title,
      summary: summary || `${sourceMeta.name} によるレスター・シティFC関連記事。`,
      body: [
        summary || `${sourceMeta.name} にて公開されたレスター・シティFC関連ニュースです。`,
        '詳細は「参照サイトを開く」から元記事をご確認ください。'
      ]
    });
  }

  return results;
}

async function fetchFeedNews(sourceMeta) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(sourceMeta.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FoxesReportBot/1.0 (+https://monaca2323.github.io/FOXES-REPORT/)'
      }
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[WARN] ${sourceMeta.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseRssItems(xml, sourceMeta);
  } catch (err) {
    console.warn(`[WARN] ${sourceMeta.name} fetch failed:`, err.message);
    return [];
  }
}

async function main() {
  let currentData = {};
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    currentData = JSON.parse(raw);
  } catch {
    console.warn('[INFO] data/lcfc.json not found, initializing structure.');
  }

  const fetchedGroups = await Promise.all(RSS_SOURCES.map(fetchFeedNews));
  const fetchedNews = fetchedGroups.flat();

  const existingNews = Array.isArray(currentData.news) ? currentData.news : [];
  const seenUrls = new Set();
  const mergedNews = [];

  for (const item of [...fetchedNews, ...existingNews]) {
    const key = (item.sourceUrl || item.title || '').trim();
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    mergedNews.push(item);
  }

  mergedNews.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const nextData = {
    ...currentData,
    seasonLabel: currentData.seasonLabel || 'Leicester City FC • EFL League One',
    standingsSource: 'EFL League One / LCFC',
    recentFiveSource: 'LCFC Match Centre / Sky Sports',
    resultsSource: 'LCFC Match Centre / Sky Sports',
    squadSource: 'LCFC Squad',
    nextMatch: {
      ...(currentData.nextMatch || {}),
      source: 'LCFC Match Centre / Sky Sports'
    },
    news: mergedNews.slice(0, 20),
    updatedAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8');
  console.log(`[OK] Updated data/lcfc.json (news count: ${nextData.news.length})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
