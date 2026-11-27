import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = path.resolve('data/lcfc.json');

const TEAM_ID = '133866';
const LEAGUE_ID = '4398';
const SDB_NEXT_URL = `https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${TEAM_ID}`;
const SDB_LAST_URL = `https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${TEAM_ID}`;
const SDB_TABLE_URL = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${LEAGUE_ID}&s=2026-2027`;
const FISHY_TABLE_URL = 'https://thefishy.co.uk/leaguetable.php?table=3';
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

function decodeHtmlText(str = '') {
  return String(str)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function isLcfcRelated(title, summary, strictTeamFeed) {
  const lowerTitle = String(title || '').toLowerCase();
  const lowerAll = `${title} ${summary}`.toLowerCase();

  if (EXCLUDE_KEYWORDS.some((kw) => lowerAll.includes(kw))) return false;
  if (strictTeamFeed) return true;

  return INCLUDE_KEYWORDS.some((kw) => lowerTitle.includes(kw) || lowerAll.includes(kw));
}

async function translateChunkToJa(chunk) {
  if (!chunk) return '';
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(chunk)) return chunk;

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
    // fallback
  }

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
    // fallback
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
    if ((current + s).length > 220) {
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

async function fetchArticleParagraphs(articleUrl, fallbackSummary = '') {
  try {
    const res = await fetch(articleUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'en-GB,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) return fallbackSummary ? [fallbackSummary] : [];

    const html = await res.text();
    const articleMatch =
      html.match(/<article[\s\S]*?<\/article>/i) ||
      html.match(/<main[\s\S]*?<\/main>/i);

    const sourcesToScan = articleMatch ? [articleMatch[0], html] : [html];
    const paragraphs = [];
    const seen = new Set();

    for (const scopeHtml of sourcesToScan) {
      const pMatches = scopeHtml.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
      for (const rawP of pMatches) {
        const clean = decodeHtmlText(rawP);
        if (!clean || clean.length < 30) continue;
        if (
          /cookie|privacy policy|terms of use|subscribe|newsletter|sign up|advert|all rights reserved|follow us on|read more:|related articles/i.test(
            clean
          )
        ) {
          continue;
        }
        const key = clean.slice(0, 60).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        paragraphs.push(clean);
        if (paragraphs.length >= 30) break;
      }
      if (paragraphs.length >= 5) break;
    }

    if (paragraphs.length > 0) return paragraphs;
    return fallbackSummary ? [fallbackSummary] : [];
  } catch {
    return fallbackSummary ? [fallbackSummary] : [];
  }
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
    return { iso: '', jstText: '日時未定', localText: '', shortDate: '' };
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

async function fetchFishyStandings() {
  try {
    const res = await fetch(FISHY_TABLE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    if (!res.ok) {
      console.warn(`[WARN] Fishy standings fetch failed: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const trMatches = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const candidates = [];

    for (const rawTr of trMatches) {
      const cellMatches = rawTr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
      const cells = cellMatches.map((c) => decodeHtmlText(c).replace(/\s+/g, ' ').trim());
      if (cells.length < 18) continue;

      const pos = Number(cells[0]);
      const team = cells[1];
      const played = Number(cells[2]);

      if (!Number.isInteger(pos) || pos < 1 || pos > 24) continue;
      if (!team || /^\d+$/.test(team)) continue;
      if (!Number.isInteger(played) || played < 1 || played > 46) continue;

      // The Fishy の標準レイアウト:
      // 0:Pos, 1:Team, 2:P, 3..12:Home/Away内訳, 13:W, 14:D, 15:L, 16:F, 17:A, 18:GD, 19:Pts
      const won = Number(cells[13]);
      const drawn = Number(cells[14]);
      const lost = Number(cells[15]);
      const gd = Number(String(cells[18]).replace(/^\+/, ''));
      const pts = Number(cells[19]);

      if ([won, drawn, lost, gd, pts].some((n) => Number.isNaN(n))) continue;
      if (pts > played * 3) continue;

      candidates.push({
        pos,
        team,
        played,
        won,
        drawn,
        lost,
        gd,
        pts
      });
    }

    // 1〜24位の連続した順位ブロックを優先的に取り出す
    const byPos = new Map();
    for (const row of candidates) {
      if (!byPos.has(row.pos)) {
        byPos.set(row.pos, row);
      }
    }

    const ordered = Array.from(byPos.values()).sort((a, b) => a.pos - b.pos);
    return ordered;
  } catch (err) {
    console.warn('[WARN] Fishy standings parse error:', err.message);
    return [];
  }
}

async function buildStandings(tableJson, fallbackStandings = []) {
  const list = tableJson?.table;
  const totalPlayed = Array.isArray(list)
    ? list.reduce((acc, r) => acc + (Number(r.intPlayed) || 0), 0)
    : 0;

  if (Array.isArray(list) && list.length >= 10 && totalPlayed > 0) {
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

  console.warn('[WARN] TheSportsDB standings unavailable; trying The Fishy...');
  const fishyStandings = await fetchFishyStandings();
  if (fishyStandings.length >= 10) {
    console.log(`[INFO] Loaded ${fishyStandings.length} teams from The Fishy`);
    return fishyStandings;
  }

  console.warn('[WARN] standings fallback: keeping existing standings');
  return fallbackStandings;
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

  const existingUpcoming = (fallbackData.upcomingFixtures || []).filter((fx) => {
    if (!fx?.date) return true;
    const endOfDayJst = new Date(`${fx.date}T23:59:59+09:00`);
    if (Number.isNaN(endOfDayJst.getTime())) return true;
    return endOfDayJst.getTime() >= now.getTime();
  });

  const upcomingFixtures = apiUpcoming.length > 0 ? apiUpcoming : existingUpcoming;

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
      rawSummary: rawDesc,
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
    .slice(0, 10);

  if (sortedNews.length === 0) {
    return fallbackNews;
  }

  const translatedNews = [];
  for (const item of sortedNews) {
    const jaTitle = await translateToJapanese(item.title);
    const rawParagraphs = await fetchArticleParagraphs(item.url, item.rawSummary);

    const jaParagraphs = [];
    for (const para of rawParagraphs) {
      const jaPara = await translateToJapanese(para);
      if (jaPara) jaParagraphs.push(jaPara);
    }

    const finalBody =
      jaParagraphs.length > 0
        ? jaParagraphs
        : [await translateToJapanese(item.rawSummary || item.title)];

    const { rawSummary, _publishedAt, ...cleanItem } = item;
    translatedNews.push({
      ...cleanItem,
      title: jaTitle,
      summary: finalBody[0] || jaTitle,
      body: finalBody,
      fullText: finalBody.join('\n\n')
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

  const standings = await buildStandings(tableJson, existingData.standings || []);
  const squad = buildSquad(squadJson, existingData.squad || []);
  const fixturesPack = buildFixturesAndResults(nextJson, lastJson, standings, existingData);
const TEAM_ALIASES = {
  blackpool: ['blackpool', 'ブラックプール'],
  'mansfield town': ['mansfield', 'mansfield town', 'マンスフィールド'],
  'cambridge united': ['cambridge', 'cambridge utd', 'cambridge united', 'ケンブリッジ'],
  'dover athletic': ['dover', 'dover athletic', 'ドーバー'],
  'sheffield wednesday': ['sheffield wed', 'sheffield wednesday', 'シェフィールド・ウェンズデイ', 'シェフィールド'],
  reading: ['reading', 'レディング'],
  'afc wimbledon': ['wimbledon', 'afc wimbledon', 'ウィンブルドン'],
  'leyton orient': ['leyton orient', 'orient', 'レイトン・オリエント'],
  'wycombe wanderers': ['wycombe', 'wycombe wanderers', 'ウィコム'],
  'doncaster rovers': ['doncaster', 'doncaster rovers', 'ドンカスター'],
  bromley: ['bromley', 'ブロムリー'],
  'luton town': ['luton', 'luton town', 'ルートン'],
  stevenage: ['stevenage', 'スティヴネイジ', 'スティーブネイジ'],
  huddersfield: ['huddersfield', 'huddersfield town', 'ハダースフィールド'],
  stockport: ['stockport', 'stockport county', 'ストックポート'],
  oxford: ['oxford', 'oxford utd', 'oxford united', 'オックスフォード'],
  plymouth: ['plymouth', 'plymouth argyle', 'プリマス'],
  'mk dons': ['mk dons', 'milton keynes', 'mkドンズ'],
  wigan: ['wigan', 'wigan athletic', 'ウィガン'],
  burton: ['burton', 'burton albion', 'バートン'],
  'notts county': ['notts county', 'notts co', 'ノッツ・カウンティ'],
  peterborough: ['peterborough', 'peterborough united', 'ピーターバラ'],
  barnsley: ['barnsley', 'バーンズリー']
};

function normalizeTeamKey(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/\b(fc|afc|utd|united|city|town|rovers|wanderers|albion|county|athletic)\b/g, ' ')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, ' ')
    .trim();
}

function findStandingsPos(standings = [], rawName = '') {
  if (!Array.isArray(standings) || standings.length === 0 || !rawName) return null;
  const rawLower = String(rawName).toLowerCase().trim();
  const normInput = normalizeTeamKey(rawName);

  const expandedKeys = new Set([rawLower, normInput].filter(Boolean));
  for (const aliases of Object.values(TEAM_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === rawLower || normalizeTeamKey(a) === normInput)) {
      aliases.forEach(a => {
        expandedKeys.add(a.toLowerCase());
        const nk = normalizeTeamKey(a);
        if (nk) expandedKeys.add(nk);
      });
    }
  }

  for (const row of standings) {
    const teamLower = String(row.team || '').toLowerCase().trim();
    const normTeam = normalizeTeamKey(row.team || '');
    for (const key of expandedKeys) {
      if (
        teamLower === key ||
        (normTeam && key && (normTeam === key || normTeam.includes(key) || key.includes(normTeam)))
      ) {
        return Number(row.pos);
      }
    }
  }
  return null;
}
 const nextMatchWithRanks = fixturesPack?.nextMatch
    ? {
        ...fixturesPack.nextMatch,
        lcfcRank: findStandingsPos(standings, 'leicester') ?? fixturesPack.nextMatch.lcfcRank,
        opponentRank:
          findStandingsPos(standings, fixturesPack.nextMatch.opponent) ??
          fixturesPack.nextMatch.opponentRank
      }
    : fixturesPack?.nextMatch;

  const nextData = {
    ...existingData,
    seasonLabel: existingData.seasonLabel || 'Leicester City FC • EFL League One',
    updatedAt: new Date().toISOString(),
    nextMatch: nextMatchWithRanks, 
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
