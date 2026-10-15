export const nasaFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NASA Image of the Day</title>
<item><title>Older &amp; wide</title><link>https://www.nasa.gov/image-detail/older/</link>
<pubDate>Wed, 07 Oct 2026 12:00 GMT</pubDate><enclosure url="https://www.nasa.gov/wp-content/uploads/2026/10/older.png" type="image/png"/></item>
<item><title>Latest portrait</title><link>https://www.nasa.gov/image-detail/portrait/</link>
<pubDate>Wed, 14 Oct 2026 12:00 GMT</pubDate><enclosure url="https://www.nasa.gov/wp-content/uploads/2026/10/portrait.jpg" type="image/jpeg"/></item>
<item><title><![CDATA[Crew returns & lands]]></title><link>https://www.nasa.gov/image-detail/crew/</link>
<pubDate>Thu, 08 Oct 2026 12:00 GMT</pubDate><enclosure url="https://www.nasa.gov/wp-content/uploads/2026/10/crew.jpg" type="image/jpeg"/></item>
</channel></rss>`;

export const nasaMetadata = [
  {
    id: 1,
    slug: "older",
    source_url: "https://www.nasa.gov/wp-content/uploads/2026/10/older.png",
    mime_type: "image/png",
    media_details: { width: 3840, height: 2160, image_meta: { credit: "NASA &amp; ESA" } },
  },
  {
    id: 2,
    slug: "portrait",
    source_url: "https://www.nasa.gov/wp-content/uploads/2026/10/portrait.jpg",
    mime_type: "image/jpeg",
    media_details: { width: 5272, height: 7908, image_meta: { credit: "Portrait author" } },
  },
  {
    id: 3,
    slug: "crew",
    source_url: "https://www.nasa.gov/wp-content/uploads/2026/10/crew.jpg",
    mime_type: "image/jpeg",
    media_details: { width: 4000, height: 2667, image_meta: { credit: "NASA/Photographer" } },
  },
];
