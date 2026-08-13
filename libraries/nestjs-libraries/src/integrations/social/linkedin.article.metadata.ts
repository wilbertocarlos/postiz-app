import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type LinkedinArticleMetadata = {
  source: string;
  title: string;
  description: string;
  image: string;
};

export function extractFirstUrl(message: string) {
  const [url] = message.match(/https?:\/\/[^\s<>()\]"']+/i) || [];
  return url ? decodeHtml(url).replace(/[.,!?;:]+$/, '') : undefined;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractHtmlAttribute(tag: string, attribute: string) {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*(['"])(.*?)\\1`, 'i')
  );
  return match?.[2] ? decodeHtml(match[2]) : undefined;
}

function extractMetaContent(html: string, key: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const found = metaTags.find((tag) => {
    const property = extractHtmlAttribute(tag, 'property');
    const name = extractHtmlAttribute(tag, 'name');
    return property?.toLowerCase() === key || name?.toLowerCase() === key;
  });

  return found ? extractHtmlAttribute(found, 'content') : undefined;
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1].replace(/\s+/g, ' ')) : '';
}

function toAbsoluteUrl(url: string, baseUrl: string) {
  if (!url) return '';

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return '';
  }
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
  errorMessage: string
) {
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize && declaredSize > maxBytes) {
    throw new Error(errorMessage);
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(errorMessage);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function parseLinkedinArticleMetadata(
  html: string,
  finalUrl: string
): LinkedinArticleMetadata {
  const source = toAbsoluteUrl(
    extractMetaContent(html, 'og:url') || finalUrl,
    finalUrl
  );
  const title =
    extractMetaContent(html, 'og:title') ||
    extractMetaContent(html, 'twitter:title') ||
    extractTitle(html);
  const description =
    extractMetaContent(html, 'og:description') ||
    extractMetaContent(html, 'description') ||
    extractMetaContent(html, 'twitter:description') ||
    '';
  const image = toAbsoluteUrl(
    extractMetaContent(html, 'og:image') ||
      extractMetaContent(html, 'twitter:image') ||
      '',
    finalUrl
  );

  if (!source || !title) {
    throw new Error('Article is missing a canonical URL or title');
  }

  return {
    source,
    title: title.slice(0, 400),
    description: description.slice(0, 512),
    image,
  };
}

export async function fetchLinkedinArticleMetadata(
  url: string
): Promise<LinkedinArticleMetadata> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Link preview URL must use HTTPS');
  }

  const response = await fetch(parsedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; PostizLinkPreview/1.0; +https://postiz.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    dispatcher: getSsrfSafeDispatcher(),
  } as RequestInit & { dispatcher: any });

  if (!response.ok) {
    throw new Error(`Article returned HTTP ${response.status}`);
  }
  if (!(response.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('Link preview URL did not return HTML');
  }

  const html = new TextDecoder().decode(
    await readLimitedBody(response, MAX_HTML_BYTES, 'Article HTML exceeds 2 MB')
  );
  const metadata = parseLinkedinArticleMetadata(
    html,
    response.url || parsedUrl.toString()
  );

  if (metadata.image && !(await isSafePublicHttpsUrl(metadata.image))) {
    metadata.image = '';
  }

  return metadata;
}

export async function fetchLinkedinArticleImage(url: string) {
  if (!(await isSafePublicHttpsUrl(url))) {
    throw new Error('Article thumbnail must be a public HTTPS image');
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; PostizLinkPreview/1.0; +https://postiz.com)',
      Accept: 'image/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
    dispatcher: getSsrfSafeDispatcher(),
  } as RequestInit & { dispatcher: any });

  if (!response.ok) {
    throw new Error(`Article thumbnail returned HTTP ${response.status}`);
  }
  if (!(response.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error('Article thumbnail URL did not return an image');
  }

  return Buffer.from(
    await readLimitedBody(
      response,
      MAX_IMAGE_BYTES,
      'Article thumbnail exceeds 20 MB'
    )
  );
}
