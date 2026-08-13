import {
  extractFirstUrl,
  parseLinkedinArticleMetadata,
} from './linkedin.article.metadata';

describe('LinkedIn article metadata', () => {
  it('extracts the first URL without trailing punctuation', () => {
    expect(
      extractFirstUrl('Lees meer op https://example.com/article?x=1&amp;y=2.')
    ).toBe('https://example.com/article?x=1&y=2');
  });

  it('reads Open Graph metadata regardless of attribute order', () => {
    const metadata = parseLinkedinArticleMetadata(
      `
        <html>
          <head>
            <meta content="Artikel &amp; nieuws" property="og:title">
            <meta property="og:description" content="Een korte omschrijving.">
            <meta content="/hero.jpg" property="og:image">
            <meta property="og:url" content="/canoniek">
          </head>
        </html>
      `,
      'https://example.com/artikel'
    );

    expect(metadata).toEqual({
      source: 'https://example.com/canoniek',
      title: 'Artikel & nieuws',
      description: 'Een korte omschrijving.',
      image: 'https://example.com/hero.jpg',
    });
  });

  it('falls back to the HTML title and final URL', () => {
    expect(
      parseLinkedinArticleMetadata(
        '<html><head><title>  Gewone titel  </title></head></html>',
        'https://example.com/final'
      )
    ).toEqual({
      source: 'https://example.com/final',
      title: 'Gewone titel',
      description: '',
      image: '',
    });
  });

  it('rejects pages without a title', () => {
    expect(() =>
      parseLinkedinArticleMetadata('<html></html>', 'https://example.com')
    ).toThrow('missing a canonical URL or title');
  });
});
