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
    url: 'https://www.leicestermercury.co.uk/all-about/leicester-city-fc?service=rss',
    strictTeamFeed: false
  },
  {
    name: 'Yorkshire Post',
    tag: 'YORKSHIRE POST',
    url: 'https://www.yorkshirepost.co.uk/sport/football/rss',
    strictTeamFeed: false
  }
];

const INCLUDE_KEYWORDS = [
  'leicester city',
  'leicester',
  'lcfc',
  'foxes',
  'king power',
  'gary rowett',
  'rowett',
  'jamie vardy',
  'vardy',
  'stevenage',
  'league one'
];

const EXCLUDE_KEYWORDS = [
  'leicester tigers',
  'tigers rugby',
  'leicestershire ccc',
  'leicester riders'
];

// ベースラインデータ（API取得前の初期補完・フォールバック用）
const BASELINE_DATA = {
  nextMatch: {
    competition: 'EFL LEAGUE ONE',
    dateLabel: '11月28日（土）24:00 KO（日本時間）',
    homeTeam: 'Stevenage',
    awayTeam: 'Leicester City',
    venue: 'Lamex Stadium (A)',
    round: '第18節',
    note: '勝ち点差2の直接対決。勝利すれば自動昇格圏内（2位以内）浮上のチャンス。'
  },
  standings: [
    { pos: 1, team: 'Birmingham City', p: 17, gd: '+21', pts: 39 },
    { pos: 2, team: 'Wycombe Wanderers', p: 17, gd: '+18', pts: 36 },
    { pos: 3, team: 'Leicester City', p: 17, gd: '+14', pts: 34, isLcfc: true },
    { pos: 4, team: 'Wrexham', p: 17, gd: '+11', pts: 33 },
    { pos: 5, team: 'Stevenage', p: 17, gd: '+8', pts: 32 },
    { pos: 6, team: 'Stockport County', p: 17, gd: '+7', pts: 30 }
  ],
  recentResults: [
    { date: '11/21', comp: 'League One', opponent: 'Barnsley (H)', score: '2 - 0', result: 'W' },
    { date: '11/14', comp: 'League One', opponent: 'Charlton Athletic (A)', score: '1 - 1', result: 'D' },
    { date: '11/07', comp: 'FA Cup 1R', opponent: 'Morecambe (H)', score: '3 - 1', result: 'W' },
    { date: '10/31', comp: 'League One', opponent: 'Reading (A)', score: '2 - 1', result: 'W' }
  ],
  squad: [
    { no: 1, name: 'Mads Hermansen', pos: 'GK', status: '主力・出場可能' },
    { no: 2, name: 'James Justin', pos: 'DF', status: '主力・出場可能' },
    { no: 4, name: 'Conor Coady', pos: 'DF', status: '主力・出場可能' },
    { no: 8, name: 'Harry Winks', pos: 'MF', status: '主力・出場可能' },
    { no: 9, name: 'Jamie Vardy', pos: 'FW', status: '主将・出場可能' },
    { no: 10, name: 'Stephy Mavididi', pos: 'FW', status: '主力・出場可能' },
    { no: 11, name: 'Bilal El Khannouss', pos: 'MF', status: '主力・出場可能' },
    { no: 18, name: 'Abdul Fatawu', pos: 'FW', status: '別メニュー調整中' }
  ]
};

function decodeXml(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLcfcRelated(title, summary, strictTeamFeed) {
  const text = `${title} ${summary}`.toLowerCase();
  if (EXCLUDE_KEYWORDS.some((kw) => text.includes(kw))) return false;
  if (strictTeamFeed) return true;
  return INCLUDE_KEYWORDS.some((kw) => text.includes(kw));
}

async function translateToJapanese(text) {
  if (!text) return '';
  // すでに日本語が多く含まれる場合はそのまま返す
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return text;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return text;
    const data = await res.json();
    const translated = data?.[0]?.map((chunk) => chunk?.[0] || '').join('').trim();
    return translated || text;
  } catch {
    return text;
  }
}

function parseRssItems(xmlText, source) {
  const items = [];
  const itemMatches = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];

  for (const rawItem of itemMatches) {
    const titleMatch = rawItem.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = rawItem.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const descMatch = rawItem.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const dateMatch = rawItem.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const title = decodeXml(titleMatch?.[1] || '');
    const link = decodeXml(linkMatch?.[1] || '');
    const rawDesc = decodeXml(descMatch?.[1] || '');
    const pubDateRaw = decodeXml(dateMatch?.[1] || '');

    if (!title || !link) continue;
    if (!isLcfcRelated(title, rawDesc, source.strictTeamFeed)) continue;

    const summary = rawDesc.length > 180 ? `${rawDesc.slice(0, 177)}...` : rawDesc;
    const parsedDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
    const validDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    items.push({
      id: link,
      source: source.tag,
      title,
      summary: summary || `${source.name} によるレスター・シティ関連記事`,
      url: link,
      publishedAt: validDate.toISOString()
    });
  }

  return items;
}

// TheSportsDB 公開APIから直近試合・次戦データを取得（取得できた場合のみ上書き）
async function fetchLiveMatches() {
  try {
    // Leicester City team ID on TheSportsDB: 133626
    const [nextRes, lastRes] = await Promise.all([
      fetch('https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=133626'),
      fetch('https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=133626')
    ]);

    let nextMatch = null;
    let recentResults = null;

    if (nextRes.ok) {
      const nextJson = await nextRes.json();
      const ev = nextJson?.events?.[0];
      if (ev && ev.strHomeTeam && ev.strAwayTeam) {
        const dt = ev.strTimestamp ? new Date(ev.strTimestamp) : null;
        const dateLabel = dt && !Number.isNaN(dt.getTime())
          ? dt.toLocaleString('ja-JP', {
              timeZone: 'Asia/Tokyo',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
              hour: '2-digit',
              minute: '2-digit'
            }) + ' KO（日本時間）'
          : `${ev.dateEvent || ''} ${ev.strTime || ''}`.trim();

        nextMatch = {
          competition: ev.strLeague || 'EFL LEAGUE ONE',
          dateLabel,
          homeTeam: ev.strHomeTeam,
          awayTeam: ev.strAwayTeam,
          venue: ev.strVenue || '未定',
          round: ev.intRound ? `第${ev.intRound}節` : '公式戦',
          note: `${ev.strHomeTeam} 対 ${ev.strAwayTeam} の公式戦カード。`
        };
      }
    }

    if (lastRes.ok) {
      const lastJson = await lastRes.json();
      const results = (lastJson?.results || []).slice(0, 5).map((ev) => {
        const isHome = /leicester/i.test(ev.strHomeTeam || '');
        const opponent = isHome ? `${ev.strAwayTeam} (H)` : `${ev.strHomeTeam} (A)`;
        const hs = Number(ev.intHomeScore);
        const as = Number(ev.intAwayScore);
        let result = 'D';
        if (!Number.isNaN(hs) && !Number.isNaN(as)) {
          if (hs === as) result = 'D';
          else if ((isHome && hs > as) || (!isHome && as > hs)) result = 'W';
          else result = 'L';
        }
        const datePart = (ev.dateEvent || '').slice(5).replace('-', '/');
        return {
          date: datePart || '--/--',
          comp: ev.strLeague || 'League',
          opponent,
          score: `${ev.intHomeScore ?? '-'} - ${ev.intAwayScore ?? '-'}`,
          result
        };
      });
      if (results.length > 0) {
        recentResults = results;
      }
    }

    return { nextMatch, recentResults };
  } catch (err) {
    console.warn('[WARN] Live match fetch skipped:', err.message);
    return { nextMatch: null, recentResults: null };
  }
}

async function main() {
  let existingData = {};
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    existingData = JSON.parse(raw);
  } catch {
    existingData = {};
  }

  // 1. RSSニュース取得＆レスター絞り込み
  const fetchedNews = [];
  for (const source of RSS_SOURCES) {
    try {
      const res = await fetch(source.url, {
        headers: { 'User-Agent': 'FOXES-REPORT-Bot/1.0' }
      });
      if (!res.ok) continue;
      const xml = await res.text();
      fetchedNews.push(...parseRssItems(xml, source));
    } catch (err) {
      console.warn(`[WARN] ${source.name} fetch error:`, err.message);
    }
  }

  const dedupMap = new Map();
  for (const item of fetchedNews) {
    const key = item.url.replace(/\?.*$/, '');
    if (!dedupMap.has(key)) dedupMap.set(key, item);
  }

  const sortedNews = Array.from(dedupMap.values())
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 12);

  // 2. ニュースのタイトル・要約を日本語に翻訳
  const translatedNews = [];
  for (const item of sortedNews) {
    const jaTitle = await translateToJapanese(item.title);
    const jaSummary = await translateToJapanese(item.summary);
    translatedNews.push({
      ...item,
      title: jaTitle,
      summary: jaSummary,
      originalTitle: item.title
    });
  }

  // 3. 試合情報の自動取得（取得できた場合のみ反映し、欠損項目は既存またはベースラインで補完）
  const liveMatches = await fetchLiveMatches();

  const updatedData = {
    updatedAt: new Date().toISOString(),
    nextMatch:
      liveMatches.nextMatch ||
      (existingData.nextMatch && Object.keys(existingData.nextMatch).length > 0
        ? existingData.nextMatch
        : BASELINE_DATA.nextMatch),
    standings:
      Array.isArray(existingData.standings) && existingData.standings.length > 0
        ? existingData.standings
        : BASELINE_DATA.standings,
    recentResults:
      liveMatches.recentResults ||
      (Array.isArray(existingData.recentResults) && existingData.recentResults.length > 0
        ? existingData.recentResults
        : BASELINE_DATA.recentResults),
    squad:
      Array.isArray(existingData.squad) && existingData.squad.length > 0
        ? existingData.squad
        : BASELINE_DATA.squad,
    news: translatedNews.length > 0 ? translatedNews : existingData.news || []
  };

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(updatedData, null, 2)}\n`, 'utf8');
  console.log(`Updated data/lcfc.json successfully. Translated news items: ${updatedData.news.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
