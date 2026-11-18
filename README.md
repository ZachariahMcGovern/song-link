# 🎵 Song Link Converter

Paste a Spotify song link and get the same song on Apple Music, SoundCloud, Amazon Music, YouTube Music, Tidal and Deezer, each with a one-tap **Copy** button.

**Live app:** https://zachariahmcgovern.github.io/song-link/

## How it works

1. Reads the song's title and cover art from Spotify's public oEmbed endpoint.
2. Searches the iTunes Search API for that title and shows the matches as covers, so you can tap the right version.
3. Builds the links:
   - **Apple Music**: an exact link to the matched track.
   - **SoundCloud, Amazon Music, YouTube Music, Tidal, Deezer**: search links for "title + artist" in each app (these services don't offer a public search API that a web page can call).
   - **song.link**: one link that opens a page with every platform.

Everything runs in your browser. There's no server, no account and no API key.

## Use it like an app

- **iPhone:** open the link in Safari → Share → **Add to Home Screen**
- **Android:** open the link in Chrome → ⋮ menu → **Add to Home screen**

## Run locally

It's a single static page. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```
