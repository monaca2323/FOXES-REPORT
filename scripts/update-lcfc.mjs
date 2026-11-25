import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = path.resolve('data/lcfc.json');

// TheSportsDB (Leicester City FC ID: 133866, EFL League One ID: 4398)
const TEAM_ID = '133866';
const LEAGUE_ID = '4398';
const SDB_NEXT_URL = `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${TEAM_ID}`;
const SDB_LAST_URL = `https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${TEAM_ID}`;
const SDB_TABLE_URL = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${LEAGUE_ID}&s=2026-2027`;
const SDB_SQUAD_URL = `https://www.thesportsdb.com/api/v1/json/3/lookup_all_players.php?id=${TEAM_ID}`;

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
  }
];

const INCLUDE_KEYWORDS = [
  'leicester city',
  'leicester',
  'lcfc',
  'foxes',
  'king power'
];

const EXCLUDE_KEYWORDS = [
  'leicester tigers',
  'tigers rugby',
  'leicestershire ccc',
  'leicester riders'
];

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
  const lowerTitle = String(title || '').toLowerCase();
  const lowerAll = `${title} ${summary}`.toLowerCase();

  if (EXCLUDE_KEYWORDS.some((kw) => lowerAll.includes(kw))) return false;
  if (strictTeamFeed) return true;

  // タイトルまたは本文にレスター関連ワードが含まれるものだけ許可
  return INCLUDE_KEYWORDS.some((kw) => lowerTitle.includes(kw) || lowerAll.includes(kw));
}
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

async function translateChunkToJa(chunk) {
  if (!chunk) return '';
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(chunk)) return chunk;

  // 1) Google翻訳エンドポイント
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ja&dt=t&q=${encodeURIComponent(chunk)}`;
    const gRes = await fetch(gUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (gRes.ok) {
      const gData = await gRes.json();
      const translated = (gData?.[0] || [])
        .map((part) => part?.[0] || '')
        .join('')
        .trim();
      if (translated && /[\u3040-\u30ff\u4e00-\u9faf]/.test(translated)) {
        return translated;
      }
    }
  } catch {
    // 次の手段へフォールバック
  }

  // 2) MyMemory APIへフォールバック
  try {
    const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|ja`;
    const mRes = await fetch(mUrl, {
      headers: { 'User-Agent': 'FOXES-REPORT-Bot/1.0' }
    });
    if (mRes.ok) {
      const mData = await mRes.json();
      const mText = mData?.responseData?.translatedText?.trim() || '';
      if (
        mText &&
        !/MYMEMORY WARNING/i.test(mText) &&
        /[\u3040-\u30ff\u4e00-\u9faf]/.test(mText)
      ) {
        return mText;
      }
    }
  } catch {
    // 翻訳失敗時は原文を返す
  }

  return chunk;
}

async function translateToJapanese(text) {
  if (!text) return '';
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return text;

  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length > 180) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const results = [];
  for (const ch of chunks) {
    results.push(await translateChunkToJa(ch));
  }
  return results.join(' ').trim() || text;
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FOXES-REPORT-Bot/1.0' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[WARN] JSON fetch error (${url}):`, err.message);
    return null;
  }
}

function toCompetitionLabel(leagueName = '') {
  const upper = String(leagueName).toUpperCase();
  if (upper.includes('FA CUP')) return 'FA (FAカップ)';
  if (upper.includes('EFL TROPHY') || upper.includes('TROPHY')) return 'EFLT (EFLトロフィー)';
  if (upper.includes('CARABAO') || upper.includes('EFL CUP')) return 'EFLC (EFLカップ)';
  return 'EFL1 (EFLリーグ1)';
}

function toLeagueShort(leagueName = '') {
  const upper = String(leagueName).toUpperCase();
  if (upper.includes('FA CUP')) return 'FA';
  if (upper.includes('EFL TROPHY') || upper.includes('TROPHY')) return 'EFLT';
  if (upper.includes('CARABAO') || upper.includes('EFL CUP')) return 'EFLC';
  return 'EFL1';
}

function parseKickoffDate(ev) {
  if (ev?.strTimestamp) {
    const d = new Date(`${ev.strTimestamp}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const datePart = ev?.dateEvent || '';
  const timePart = (ev?.strTime || '00:00:00').slice(0, 8);
  if (datePart) {
    const d = new Date(`${datePart}T${timePart}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function formatJstStrings(dateObj) {
  if (!dateObj || Number.isNaN(dateObj.getTime())) {
    return {
      iso: '',
      jstText: '日時未定',
      localText: '',
      shortDate: ''
    };
  }

  const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = Object.fromEntries(
    jstFormatter.formatToParts(dateObj).map((p) => [p.type, p.value])
  );

  const gmtFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const jstDateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dateObj);

  return {
    iso: dateObj.toISOString(),
    jstText: `${parts.year}年${parts.month}月${parts.day}日 (${parts.weekday}) ${parts.hour}:${parts.minute}`,
    localText: `現地: ${gmtFormatter.format(dateObj)}`,
    shortDate: jstDateParts
  };
}

function buildStandings(tableJson, fallbackStandings = []) {
  const list = tableJson?.table;
  if (!Array.isArray(list) || list.length < 10) return fallbackStandings;

  const totalPlayed = list.reduce((acc, r) => acc + (Number(r.intPlayed) || 0), 0);
  if (totalPlayed === 0) return fallbackStandings;

  return list
    .map((row, idx) => ({
      pos: Number(row.intRank) || idx + 1,
      team: String(row.strTeam || '').trim(),
      played: Number(row.intPlayed) || 0,
      won: Number(row.intWin) || 0,
      drawn: Number(row.intDraw) || 0,
      lost: Number(row.intLoss) || 0,
      gd: Number(row.intGoalDifference) || 0,
      pts: Number(row.intPoints) || 0
    }))
    .filter((r) => r.team)
    .sort((a, b) => a.pos - b.pos);
}

function mapPositionCode(rawPos = '') {
  const p = String(rawPos).toLowerCase();
  if (p.includes('goal') || p === 'gk') return 'GK';
  if (p.includes('back') || p.includes('def') || p.includes('centre-back') || p.includes('full-back') || p === 'df') return 'DF';
  if (p.includes('mid') || p === 'mf') return 'MF';
  if (p.includes('wing') || p.includes('forward') || p.includes('striker') || p.includes('attack') || p === 'fw') return 'FW';
  return 'MF';
}

function toCountryCode(nat = '') {
  const s = String(nat).trim();
  const map = {
    England: 'ENG',
    Wales: 'WAL',
    Scotland: 'SCO',
    'Northern Ireland': 'NIR',
    Ireland: 'IRL',
    Denmark: 'DEN',
    Poland: 'POL',
    Italy: 'ITA',
    France: 'FRA',
    Australia: 'AUS',
    Jamaica: 'JAM',
    Argentina: 'ARG',
    Finland: 'FIN',
    'Bosnia and Herzegovina': 'BIH'
  };
  if (map[s]) return map[s];
  return s.slice(0, 3).toUpperCase() || 'UNK';
}

function buildSquad(playersJson, fallbackSquad = []) {
  const list = playersJson?.player;
  if (!Array.isArray(list) || list.length < 5) return fallbackSquad;

  const mapped = list
    .filter((p) => p?.strPlayer && !/retired/i.test(String(p?.strStatus || '')))
    .map((p) => {
      const numRaw = String(p.strNumber || '').replace(/[^\d]/g, '');
      return {
        number: numRaw ? Number(numRaw) : 99,
        name: String(p.strPlayer).trim(),
        position: mapPositionCode(p.strPosition),
        nationality: toCountryCode(p.strNationality)
      };
    });

  return mapped.length >= 5 ? mapped : fallbackSquad;
}

function buildFixturesAndResults(nextJson, lastJson, standings, fallbackData) {
  const now = new Date();
  const upcomingRaw = Array.isArray(nextJson?.events) ? nextJson.events : [];
  const pastRaw = Array.isArray(lastJson?.results) ? lastJson.results : [];

  const apiUpcoming = upcomingRaw
    .map((ev) => {
      const home = String(ev.strHomeTeam || '').trim();
      const away = String(ev.strAwayTeam || '').trim();
      const isHome = /leicester/i.test(home);
      const opponent = isHome ? away : home;
      const dt = parseKickoffDate(ev);
      const fmt = formatJstStrings(dt);
      return {
        date: fmt.shortDate || ev.dateEvent || '',
        competition: toCompetitionLabel(ev.strLeague),
        opponent,
        isHome,
        venue: ev.strVenue || (isHome ? 'King Power Stadium' : 'Away Stadium'),
        _dt: dt
      };
    })
    .filter((item) => !item._dt || item._dt.getTime() >= now.getTime() - 2 * 60 * 60 * 1000)
    .map(({ _dt, ...rest }) => rest);

  // 既存upcomingFixturesから、すでに日付が過ぎた試合を除外して自動繰り上げに活かす
  const existingUpcoming = (fallbackData.upcomingFixtures || []).filter((fx) => {
    if (!fx?.date) return true;
    const endOfDayJst = new Date(`${fx.date}T23:59:59+09:00`);
    if (Number.isNaN(endOfDayJst.getTime())) return true;
    return endOfDayJst.getTime() >= now.getTime();
  });

  const upcomingFixtures =
    apiUpcoming.length > 0 ? apiUpcoming : existingUpcoming;

  const pastResults =
    pastRaw.length > 0
      ? pastRaw.map((ev) => {
          const home = String(ev.strHomeTeam || '').trim();
          const away = String(ev.strAwayTeam || '').trim();
          const isHome = /leicester/i.test(home);
          const opponent = isHome ? away : home;
          const hGoals = Number(ev.intHomeScore);
          const aGoals = Number(ev.intAwayScore);
          const lcfcGoals = isHome ? hGoals : aGoals;
          const oppGoals = isHome ? aGoals : hGoals;

          let outcome = 'D';
          if (!Number.isNaN(lcfcGoals) && !Number.isNaN(oppGoals)) {
            if (lcfcGoals > oppGoals) outcome = 'W';
            else if (lcfcGoals < oppGoals) outcome = 'L';
          }

          const dt = parseKickoffDate(ev);
          const fmt = formatJstStrings(dt);
          const score =
            !Number.isNaN(hGoals) && !Number.isNaN(aGoals) ? `${hGoals} - ${aGoals}` : '0 - 0';

          return {
            date: fmt.shortDate || ev.dateEvent || '',
            competition: toCompetitionLabel(ev.strLeague),
            opponent,
            isHome,
            score,
            outcome
          };
        })
      : fallbackData.pastResults || [];

  const recentFiveForm =
    pastRaw.length > 0
      ? pastResults.slice(0, 5).map((r) => ({
          leagueCode: toLeagueShort(r.competition),
          competition: r.competition,
          opponent: r.opponent,
          isHome: r.isHome,
          outcome: r.outcome,
          score: r.score
        }))
      : fallbackData.recentFiveForm || [];

  let nextMatch = fallbackData.nextMatch;

  // APIに次戦があれば更新
  if (upcomingRaw.length > 0) {
    const first = upcomingRaw[0];
    const home = String(first.strHomeTeam || '').trim();
    const away = String(first.strAwayTeam || '').trim();
    const isHome = /leicester/i.test(home);
    const opponent = isHome ? away : home;
    const oppCode = String(opponent || 'OPP')
      .replace(/[^A-Za-z]/g, '')
      .slice(0, 3)
      .toUpperCase();

    const lcfcRow = standings.find((r) => /leicester/i.test(r.team));
    const oppRow = standings.find(
      (r) => r.team.toLowerCase() === opponent.toLowerCase()
    );

    const dt = parseKickoffDate(first);
    const fmt = formatJstStrings(dt);
    const latest = pastResults[0];
    const highlightText = latest
      ? `直近の${latest.opponent}戦は ${latest.score}（${latest.outcome === 'W' ? '勝利' : latest.outcome === 'L' ? '敗戦' : '引分'}）`
      : fallbackData.nextMatch?.highlightText || '';

    nextMatch = {
      ...(fallbackData.nextMatch || {}),
      competition: toLeagueShort(first.strLeague),
      opponent,
      opponentCode: oppCode || 'OPP',
      opponentRank: oppRow?.pos ?? fallbackData.nextMatch?.opponentRank ?? 0,
      opponentRecord: oppRow
        ? `勝点 ${oppRow.pts} (${oppRow.won}勝${oppRow.drawn}分${oppRow.lost}敗)`
        : fallbackData.nextMatch?.opponentRecord || '',
      lcfcRank: lcfcRow?.pos ?? fallbackData.nextMatch?.lcfcRank ?? 0,
      lcfcRecord: lcfcRow
        ? `勝点 ${lcfcRow.pts} (${lcfcRow.won}勝${lcfcRow.drawn}分${lcfcRow.lost}敗)`
        : fallbackData.nextMatch?.lcfcRecord || '',
      isHome,
      date: fmt.jstText ? `${fmt.jstText} (JST)` : '',
      kickoffIso: fmt.iso,
      jstText: fmt.jstText,
      localText: fmt.localText,
      venue: `${first.strVenue || 'Stadium'} (${isHome ? 'Home' : 'Away'})`,
      highlightText,
      source: 'TheSportsDB / LCFC Match Centre'
    };
  } else if (
    fallbackData.nextMatch?.kickoffIso &&
    new Date(fallbackData.nextMatch.kickoffIso).getTime() < now.getTime() - 2 * 60 * 60 * 1000 &&
    upcomingFixtures.length > 0
  ) {
    // APIが未反映でもキックオフ時刻を過ぎた次戦があれば、upcomingFixturesの先頭へ自動繰り上げ
    const nextFx = upcomingFixtures[0];
    const lcfcRow = standings.find((r) => /leicester/i.test(r.team));
    const oppRow = standings.find(
      (r) => r.team.toLowerCase() === String(nextFx.opponent || '').toLowerCase()
    );
    nextMatch = {
      ...(fallbackData.nextMatch || {}),
      competition: toLeagueShort(nextFx.competition),
      opponent: nextFx.opponent,
      opponentCode: String(nextFx.opponent || 'OPP')
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase(),
      opponentRank: oppRow?.pos ?? fallbackData.nextMatch?.opponentRank ?? 0,
      opponentRecord: oppRow
        ? `勝点 ${oppRow.pts} (${oppRow.won}勝${oppRow.drawn}分${oppRow.lost}敗)`
        : fallbackData.nextMatch?.opponentRecord || '',
      lcfcRank: lcfcRow?.pos ?? fallbackData.nextMatch?.lcfcRank ?? 0,
      lcfcRecord: lcfcRow
        ? `勝点 ${lcfcRow.pts} (${lcfcRow.won}勝${lcfcRow.drawn}分${lcfcRow.lost}敗)`
        : fallbackData.nextMatch?.lcfcRecord || '',
      isHome: Boolean(nextFx.isHome),
      date: `${nextFx.date} (JST)`,
      kickoffIso: `${nextFx.date}T00:00:00+09:00`,
      jstText: `${nextFx.date}`,
      localText: '',
      venue: `${nextFx.venue || 'Stadium'} (${nextFx.isHome ? 'Home' : 'Away'})`
    };
  }

  return {
    nextMatch,
    recentFiveForm,
    upcomingFixtures,
    pastResults
  };
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
    const dateStr = validDate.toISOString().slice(0, 10);

    items.push({
      id: link,
      tag: source.tag,
      date: dateStr,
      source: `${source.name}（外部ソース参考）`,
      sourceUrl: link,
      url: link,
      title,
      summary: summary || `${source.name} によるレスター・シティ関連記事`,
      body: [summary || `${source.name} によるレスター・シティ関連記事`],
      _publishedAt: validDate.toISOString()
    });
  }

  return items;
}

async function fetchTranslatedNews(fallbackNews = []) {
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
    .sort((a, b) => new Date(b._publishedAt) - new Date(a._publishedAt))
    .slice(0, 12);

  if (sortedNews.length === 0) {
    return fallbackNews;
  }

  const translatedNews = [];
  for (const item of sortedNews) {
    const jaTitle = await translateToJapanese(item.title);
    const jaSummary = await translateToJapanese(item.summary);
    const { _publishedAt, ...cleanItem } = item;
    translatedNews.push({
      ...cleanItem,
      title: jaTitle,
      summary: jaSummary,
      body: [jaSummary]
    });
  }

  return translatedNews.length > 0 ? translatedNews : fallbackNews;
}

async function main() {
  let existingData = {};
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    existingData = JSON.parse(raw);
  } catch {
    existingData = {};
  }

  const [nextJson, lastJson, tableJson, squadJson, translatedNews] = await Promise.all([
    fetchJsonSafe(SDB_NEXT_URL),
    fetchJsonSafe(SDB_LAST_URL),
    fetchJsonSafe(SDB_TABLE_URL),
    fetchJsonSafe(SDB_SQUAD_URL),
    fetchTranslatedNews(existingData.news || [])
  ]);

  const standings = buildStandings(tableJson, existingData.standings || []);
  const squad = buildSquad(squadJson, existingData.squad || []);
  const fixturesPack = buildFixturesAndResults(nextJson, lastJson, standings, existingData);

  const nextData = {
    ...existingData,
    seasonLabel: existingData.seasonLabel || 'Leicester City FC • EFL League One',
    updatedAt: new Date().toISOString(),
    nextMatch: fixturesPack.nextMatch,
    recentFiveForm: fixturesPack.recentFiveForm,
    upcomingFixtures: fixturesPack.upcomingFixtures,
    pastResults: fixturesPack.pastResults,
    standings,
    squad,
    news: translatedNews
  };

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8');
  console.log(
    `Updated LCFC data -> news:${nextData.news.length}, standings:${nextData.standings.length}, squad:${nextData.squad.length}, upcoming:${nextData.upcomingFixtures.length}, results:${nextData.pastResults.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
