/**
 * Song Link Converter
 * --------------------
 * Paste a Spotify track link and get the same song on other platforms.
 *
 * Flow:
 *   1. Pull the track ID out of the pasted Spotify URL.
 *   2. Ask Spotify's public oEmbed endpoint for the song title and cover art.
 *   3. Search the iTunes Search API for that title to find the song on
 *      Apple Music (this also gives us the artist name).
 *   4. Show the matches as covers so the user can pick the right version,
 *      then build the links for every platform.
 *
 * Both APIs are free, need no key, and allow requests straight from the
 * browser, so the whole app is a static page with no backend.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const SPOTIFY_OEMBED = 'https://open.spotify.com/oembed?url=';
  const ITUNES_SEARCH = 'https://itunes.apple.com/search?entity=song&country=us&limit=10&term=';
  const SONGLINK = 'https://song.link/s/'; // + Spotify track ID
  const MAX_MATCHES = 8;

  /**
   * Platforms without a browser-friendly search API. We can't link straight
   * to the track, so each one opens that service's search for "title artist".
   * Order here is the order shown on the page.
   */
  const SEARCH_PLATFORMS = [
    { label: 'SoundCloud',    color: '#ff5500', url: (q) => 'https://soundcloud.com/search/sounds?q=' + encodeURIComponent(q) },
    { label: 'Amazon Music',  color: '#17aaff', url: (q) => 'https://music.amazon.com/search/' + encodeURIComponent(q) },
    { label: 'YouTube Music', color: '#ff0000', url: (q) => 'https://music.youtube.com/search?q=' + encodeURIComponent(q) },
    { label: 'YouTube',       color: '#cc0000', url: (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) },
    { label: 'Tidal',         color: '#000000', url: (q) => 'https://listen.tidal.com/search?q=' + encodeURIComponent(q) },
    { label: 'Deezer',        color: '#a238ff', url: (q) => 'https://www.deezer.com/search/' + encodeURIComponent(q) },
  ];

  // ---------------------------------------------------------------------------
  // DOM references and app state
  // ---------------------------------------------------------------------------

  const urlInput = document.getElementById('url');
  const goBtn = document.getElementById('go');
  const pasteBtn = document.getElementById('paste');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');

  /** Current lookup: { id, title, thumb, matches: [], sel: index of chosen match } */
  let state = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Show a status line under the input (or hide it when msg is empty). */
  function setStatus(msg, isError) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isError ? ' err' : '');
  }

  /** Escape text before putting it into HTML. */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Normalize a title for comparison: lowercase, drop "(feat. ...)",
   * "[Remastered]", " - Live" and punctuation.
   */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/ - .*$/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Extract the track ID from any Spotify track URL, including ones with
   * ?si= tracking parameters or /intl-xx/ paths. Returns null if not a track.
   */
  function parseSpotifyUrl(raw) {
    const m = raw.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]+)/);
    return m ? { id: m[1], url: 'https://open.spotify.com/track/' + m[1] } : null;
  }

  /** Copy text to the clipboard and briefly show "Copied ✓" on the button. */
  function copyText(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1400);
    };
    // Fallback for older browsers / non-secure contexts.
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Build one platform row with Open + Copy buttons. */
  function platformRow(label, color, url, exact, subtitle) {
    const row = document.createElement('div');
    row.className = 'plat';
    row.innerHTML = `
      <div class="ic" style="background:${color}">${esc(label.charAt(0))}</div>
      <div class="name">
        <b>${esc(label)}<span class="tag ${exact ? 'exact">Exact' : 'search">Search'}</span></b>
        ${subtitle ? `<small>${esc(subtitle)}</small>` : ''}
      </div>
      <div class="btns">
        <a href="${esc(url)}" target="_blank" rel="noopener">Open</a>
        <button type="button">Copy</button>
      </div>`;
    row.querySelector('button').addEventListener('click', (e) => copyText(url, e.currentTarget));
    return row;
  }

  function heading(text) {
    const h = document.createElement('h2');
    h.textContent = text;
    return h;
  }

  /** Draw the song card, cover picker and platform links from `state`. */
  function render() {
    const pick = state.matches[state.sel];
    const artist = pick ? pick.artistName : '';
    const query = (state.title + ' ' + artist).trim();
    resultEl.innerHTML = '';

    // Song card
    const card = document.createElement('div');
    card.className = 'track';
    card.innerHTML = `
      ${state.thumb ? `<img src="${esc(state.thumb)}" alt="">` : ''}
      <div><p class="t">${esc(state.title)}</p><p class="a">${esc(artist || 'Spotify')}</p></div>`;
    resultEl.appendChild(card);

    // Cover picker, only when more than one song has this title
    if (state.matches.length > 1) {
      resultEl.appendChild(heading('Which one is it? (match the cover)'));
      const picker = document.createElement('div');
      picker.className = 'matches';
      state.matches.forEach((m, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'match' + (i === state.sel ? ' sel' : '');
        b.innerHTML = `
          <img src="${esc((m.artworkUrl100 || '').replace('100x100', '200x200'))}" alt="">
          <b>${esc(m.trackName)}</b><small>${esc(m.artistName)}</small>`;
        b.addEventListener('click', () => { state.sel = i; render(); });
        picker.appendChild(b);
      });
      resultEl.appendChild(picker);
    }

    // Platform links
    resultEl.appendChild(heading('Links'));
    if (pick) {
      const appleUrl = pick.trackViewUrl.replace(/[?&]uo=\d+/, ''); // strip affiliate tag
      resultEl.appendChild(platformRow('Apple Music', '#fa2d48', appleUrl, true, pick.collectionName));
    } else {
      resultEl.appendChild(platformRow('Apple Music', '#fa2d48',
        'https://music.apple.com/us/search?term=' + encodeURIComponent(query), false));
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = 'No exact Apple Music match found, so this is a search link.';
      resultEl.appendChild(note);
    }
    SEARCH_PLATFORMS.forEach((p) => resultEl.appendChild(platformRow(p.label, p.color, p.url(query), false, query)));
    resultEl.appendChild(platformRow('song.link (all platforms)', '#1db954', SONGLINK + state.id, true,
      'One link that opens every service'));
  }

  /** Shown if the lookups fail (offline, API down): still give a working link. */
  function renderFallback(trackId) {
    resultEl.innerHTML = '';
    resultEl.appendChild(heading('Your link'));
    resultEl.appendChild(platformRow('song.link (all platforms)', '#1db954', SONGLINK + trackId, true,
      'Opens a page with Apple Music, Amazon, Tidal & more'));
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Couldn’t look up the song details right now, but this link still works.';
    resultEl.appendChild(note);
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  async function lookup() {
    const raw = urlInput.value.trim();
    if (!raw) return setStatus('Paste a Spotify song link first.', true);

    const track = parseSpotifyUrl(raw);
    if (!track) return setStatus('That isn’t a Spotify song link. It should look like open.spotify.com/track/…', true);

    resultEl.innerHTML = '';
    setStatus('Finding matches…');
    goBtn.disabled = true;

    try {
      // 1. Title + cover art from Spotify
      const oembedRes = await fetch(SPOTIFY_OEMBED + encodeURIComponent(track.url));
      if (!oembedRes.ok) throw new Error('spotify');
      const song = await oembedRes.json();
      state = { id: track.id, title: song.title, thumb: song.thumbnail_url, matches: [], sel: 0 };

      // 2. Apple Music matches by title (a failed search just means no exact link)
      let results = [];
      try {
        const r = await fetch(ITUNES_SEARCH + encodeURIComponent(song.title));
        if (r.ok) results = (await r.json()).results || [];
      } catch (e) { /* fall through with no matches */ }

      // Prefer songs whose title matches exactly; otherwise keep the closest results.
      const target = normalize(song.title);
      const valid = results.filter((x) => x.trackViewUrl);
      const exact = valid.filter((x) => normalize(x.trackName) === target);
      state.matches = (exact.length ? exact : valid).slice(0, MAX_MATCHES);

      render();
      setStatus('');
    } catch (err) {
      if (err.message === 'spotify') setStatus('Spotify couldn’t find that song. Check the link.', true);
      else { renderFallback(track.id); setStatus(''); }
    } finally {
      goBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  goBtn.addEventListener('click', lookup);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
  // Run automatically right after a paste into the box.
  urlInput.addEventListener('paste', () => setTimeout(lookup, 50));

  // "Paste from clipboard" button (browsers may ask for permission first).
  pasteBtn.addEventListener('click', async () => {
    try {
      urlInput.value = (await navigator.clipboard.readText()).trim();
      lookup();
    } catch (e) {
      urlInput.focus();
      setStatus('Long-press the box and tap Paste.');
    }
  });
})();
