// Reads real tag data (title/artist/album + embedded cover art) straight
// from the audio file, used ONLY for the currently playing track — never for
// list rows, since this always costs at least one network read per file.
//
// Uses jsmediatags (loaded via CDN in index.html) rather than a hand-rolled
// parser: a first attempt at parsing ID3 by hand missed real-world tag
// variants (extended headers, unsynchronization, older ID3v2.2 tags), and a
// battle-tested library handles all of that plus MP4/FLAC tags for free.
// jsmediatags does its own efficient range-based reads when given a URL, so
// this still doesn't download whole files.

function readId3Tags(fileUrl) {
  return new Promise((resolve) => {
    jsmediatags.read(fileUrl, {
      onSuccess: (tag) => {
        const t = (tag && tag.tags) || {};
        let picture = null;
        if (t.picture && t.picture.data && t.picture.data.length) {
          picture = {
            mimeType: t.picture.format || "image/jpeg",
            bytes: new Uint8Array(t.picture.data),
          };
        }
        resolve({
          artist: t.artist || null,
          album: t.album || null,
          title: t.title || null,
          picture,
        });
      },
      onError: () => resolve(null),
    });
  });
}
