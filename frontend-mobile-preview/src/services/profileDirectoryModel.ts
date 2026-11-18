import type { DirectoryPage } from './profileDirectoryApi';
import type { DirectorySession } from '../store/useProfileDirectoryStore';

export const LOCAL_DIRECTORY_PAGE_SIZE = 50;
export const normalizeProfileSearch = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();

export const KNOWN_MALE_PERFORMERS = new Set([
  'johnny-sins', 'johnny sins', 'danny-d', 'danny d', 'tim-deen', 'tim deen',
  'jordi-el-nino-polla', 'jordi el nino polla', 'jordi', 'alex-adams', 'alex adams',
  'rocco-siffredi', 'rocco siffredi', 'mick-blue', 'mick blue', 'manuel-ferrara', 'manuel ferrara',
  'keiran-lee', 'keiran lee', 'kieran-lee', 'kieran lee', 'markus-dupree', 'markus dupree',
  'tommy-gunn', 'tommy gunn', 'nacho-vidal', 'nacho vidal', 'christian-clay', 'christian clay',
  'seth-gamble', 'seth gamble', 'charles-dera', 'charles dera', 'evan-stone', 'evan stone',
  'james-deen', 'james deen', 'ramon-nomar', 'ramon nomar', 'logan-long', 'logan long',
  'scott-nails', 'scott nails', 'peter-green', 'peter green', 'bill-bailey', 'bill bailey',
  'tony-rubino', 'tony rubino', 'ricky-johnson', 'ricky johnson', 'dread-full', 'dread full',
  'isiah-maxwell', 'isiah maxwell', 'rob-piper', 'rob piper', 'jean-val-jean', 'jean val jean',
  'rick-adams', 'rick adams', 'vince-karter', 'vince karter', 'lucas-frost', 'lucas frost',
  'mark-wood', 'mark wood', 'trent-tesoro', 'trent tesoro', 'adam-russo', 'adam russo',
  'alex-legend', 'alex legend', 'mr-pete', 'mr pete', 'mr. pete', 'erik-everhard', 'erik everhard',
  'steve-holmes', 'steve holmes', 'john-strong', 'john strong', 'michael-stefano', 'michael stefano',
  'barry-scott', 'barry scott', 'jack-hammer', 'jack hammer', 'jules-jordan', 'jules jordan',
  'guy-di-silva', 'guy di silva', 'marco-banderas', 'marco banderas', 'chris-strokes', 'chris strokes',
  'bruce-venture', 'bruce venture', 'damon-dice', 'damon dice', 'danny-mountain', 'danny mountain',
  'sterling-knight', 'sterling knight', 'quinton-james', 'quinton james', 'codey-steele', 'codey steele',
  'jax-slayer', 'jax slayer', 'oliver-davis', 'oliver davis', 'zac-wild', 'zac wild',
  'tony-t', 'tony t', 'pierce-paris', 'pierce paris', 'ryan-mclane', 'ryan mclane',
  'derrick-pierce', 'derrick pierce', 'sean-lawless', 'sean lawless', 'chad-white', 'chad white',
  'trenton-ducati', 'trenton ducati', 'will-pounder', 'will pounder'
]);

export function isPerformerMale(name?: string | null, sourceUrl?: string | null): boolean {
  if (name) {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    if (KNOWN_MALE_PERFORMERS.has(cleanName)) return true;
    const slugName = cleanName.replace(/\s+/g, '-');
    if (KNOWN_MALE_PERFORMERS.has(slugName)) return true;
  }
  if (sourceUrl) {
    try {
      const slug = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop()?.toLowerCase();
      if (slug && (KNOWN_MALE_PERFORMERS.has(slug) || KNOWN_MALE_PERFORMERS.has(slug.replace(/-/g, ' ')))) return true;
    } catch {}
  }
  return false;
}

export function projectDirectory(session: DirectorySession, language: string, localLetter?: string | null, genderOverride?: string | null) {
  const page = session.pages[session.pageUrl];
  const query = normalizeProfileSearch(session.search);

  let activeGender: string | null = genderOverride !== undefined ? genderOverride : null;
  if (!activeGender && page?.page_url) {
    try {
      activeGender = new URL(page.page_url).searchParams.get('gender');
    } catch {}
  }

  const local = Boolean(query) || session.sort !== 'source' || Boolean(localLetter);
  const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  let items = local || session.appendMode ? Object.values(session.profiles) : (page?.items ?? []);

  if (activeGender === 'female') {
    items = items.filter(item => item.gender !== 'male' && !isPerformerMale(item.name, item.source_url));
  } else if (activeGender === 'male') {
    items = items.filter(item => item.gender === 'male' || isPerformerMale(item.name, item.source_url));
  } else if (activeGender === 'trans') {
    items = items.filter(item => item.gender === 'trans');
  }

  if (localLetter) {
    const l = localLetter.trim().toUpperCase();
    items = items.filter(item => (item.name ?? '').trim().toUpperCase().startsWith(l));
  }
  if (query) items = items.filter(item => normalizeProfileSearch(item.name ?? '').includes(query));
  if (session.sort === 'name' || session.sort === 'name_desc') {
    items = [...items].sort((a, b) => {
      if (!a.name) return b.name ? 1 : a.key.localeCompare(b.key);
      if (!b.name) return -1;
      return (session.sort === 'name_desc' ? -1 : 1) * collator.compare(a.name, b.name) || a.key.localeCompare(b.key);
    });
  } else if (['rank', 'video_count', 'photo_count'].includes(session.sort)) {
    const field = session.sort as 'rank' | 'video_count' | 'photo_count';
    items = [...items].sort((a, b) => {
      if (a[field] == null) return b[field] == null ? a.key.localeCompare(b.key) : 1;
      if (b[field] == null) return -1;
      return (field === 'rank' ? 1 : -1) * (a[field]! - b[field]!) || a.key.localeCompare(b.key);
    });
  }
  const total = items.length;
  // Local pagination ONLY applies when filtering/searching in-memory results (search query, local sorting, or local letter).
  // Remote directory browsing must preserve remote pagination so the user can navigate all remote pages (thousands of profiles).
  const shouldPaginateLocally = local;
  const pageCount = shouldPaginateLocally ? Math.max(1, Math.ceil(total / LOCAL_DIRECTORY_PAGE_SIZE)) : 1;
  const displayPage = shouldPaginateLocally ? Math.max(1, Math.min(session.displayPage, pageCount)) : 1;
  return {
    items: shouldPaginateLocally ? items.slice((displayPage - 1) * LOCAL_DIRECTORY_PAGE_SIZE, displayPage * LOCAL_DIRECTORY_PAGE_SIZE) : items,
    local: shouldPaginateLocally,
    total,
    pageCount,
    displayPage,
    loaded: Object.keys(session.profiles).length,
  };
}

/** Use the adapter's first-page URL; UI never edits source route segments. */
export function directoryFilterUrl(page: DirectoryPage, values: Record<string, string[]>, categoryUrl?: string) {
  if (page.adapter_id === 'xhamster') {
    let baseUrl = categoryUrl;
    if (!baseUrl) {
      const country = values['country']?.[0];
      const format = values['format']?.[0];
      const section = values['section']?.[0];
      if (country) {
        baseUrl = page.capabilities.category_links[`country_${country}`] || `https://xhamster.com/pornstars/all/countries/${country}`;
      } else if (format === '4k') {
        baseUrl = page.capabilities.category_links['format_4k'] || 'https://xhamster.com/pornstars/all/4k';
      } else if (format === 'vr') {
        baseUrl = page.capabilities.category_links['format_vr'] || 'https://xhamster.com/pornstars/all/vr';
      } else if (section && page.capabilities.category_links[section]) {
        baseUrl = page.capabilities.category_links[section];
      } else {
        baseUrl = page.capabilities.all_url || 'https://xhamster.com/pornstars';
      }
    }
    const url = new URL(baseUrl);
    const gender = values['gender']?.[0];
    if (gender) {
      url.searchParams.set('gender', gender);
    } else {
      url.searchParams.delete('gender');
    }
    return url.toString();
  }

  const base = categoryUrl || page.capabilities.query_url;
  if (!base) throw new Error('directory_filters_unavailable');
  const url = new URL(base);
  for (const field of page.capabilities.remote_filters) {
    url.searchParams.delete(field.name);
    const selected = values[field.name] ?? [];
    for (const value of selected.filter(value => value !== '')) {
      if (field.kind === 'choice' && !field.choices.some(choice => choice.value === value)) throw new Error('invalid_directory_filter');
      if (field.kind === 'number' && (!/^\d+$/.test(value) || field.minimum != null && Number(value) < field.minimum || field.maximum != null && Number(value) > field.maximum)) throw new Error('invalid_directory_filter');
      url.searchParams.append(field.name, value);
    }
  }
  return url.toString();
}
