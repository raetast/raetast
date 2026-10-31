// Parse the large Wikidata payload away from the UI, keeping tooltip fields only.
self.onmessage = ({ data: { id, json } }) => {
  try {
    const data = JSON.parse(json);
    const entities = Object.values(data?.entities || {})
      .filter((entity) => entity && !entity.missing)
      .map((entity) => ({
        id: entity.id,
        labels: { en: entity.labels?.en },
        descriptions: { en: entity.descriptions?.en },
        claims: { P569: entity.claims?.P569, P570: entity.claims?.P570 },
        sitelinks: entity.sitelinks?.enwiki ? { enwiki: entity.sitelinks.enwiki } : {},
        sitelinkCount: Object.keys(entity.sitelinks || {}).length,
      }));
    self.postMessage({ id, entities });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
