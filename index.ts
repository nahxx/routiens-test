import * as cron from "node-cron";
import axios from "axios";

const NEWS_URL =
  process.env.NEWS_URL ??
  "https://finance.naver.com/news/mainnews.naver";

const SLACK_WEBHOOK_URL =
  process.env.SLACK_WEBHOOK_URL ?? "";

interface NewsItem {
  title: string;
  link: string;
  thumb: string | null;
  lede: string;
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  accessory?: { type: string; image_url: string; alt_text: string };
}

function decodeHtml(html: string): string {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&middot;/g, "·")
    .replace(/&hellip;/g, "...")
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .trim();
}

function extractNewsItems(rawHtml: string): NewsItem[] {
  const itemRegex = /<li class="block1">([\s\S]*?)<\/li>/g;
  const newsItems: NewsItem[] = [];
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(rawHtml)) !== null) {
    const itemHtml = itemMatch[1];

    const subjectM = itemHtml.match(
      /<dd class="articleSubject">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
    );
    const thumbM = itemHtml.match(/<dt class="thumb">[\s\S]*?<img src='([^']+)'/);
    const summaryM = itemHtml.match(/<dd class="articleSummary">([\s\S]*?)<span class="press">/);

    if (!subjectM) continue;

    let link = subjectM[1];
    if (link.startsWith("/")) {
      link = "https://finance.naver.com" + link;
    }

    const title = decodeHtml(subjectM[2]);

    let lede = "본문 요약 없음";
    if (summaryM) {
      lede = decodeHtml(summaryM[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " "));
    }

    let thumb: string | null = null;
    if (thumbM) {
      let thumbUrl = thumbM[1];
      if (!thumbUrl.includes("thumb_72x54.gif")) {
        const match = thumbUrl.match(/\/(\d{3})\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)\.jpg/);
        if (match) {
          const [, officeId, yyyy, mm, dd, articleId] = match;
          thumbUrl = `https://imgnews.pstatic.net/image/origin/${officeId}/${yyyy}/${mm}/${dd}/${articleId}.jpg`;
        }
        thumb = decodeHtml(thumbUrl);
      }
    }

    newsItems.push({ title, link, thumb, lede });
  }

  return newsItems;
}

function buildSlackBlocks(topFive: NewsItem[]): SlackBlock[] {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Seoul",
  });

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📢 실시간 돈 냄새 나는 증권 뉴스 5 (${today} 기준)`,
        emoji: true,
      },
    },
    { type: "divider" },
  ];

  topFive.forEach((item, index) => {
    const sectionBlock: SlackBlock = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${index + 1}. <${item.link}|${item.title}>*\n_${item.lede}_`,
      },
    };

    if (item.thumb?.startsWith("http")) {
      sectionBlock.accessory = {
        type: "image",
        image_url: item.thumb,
        alt_text: "thumbnail",
      };
    }

    blocks.push(sectionBlock);
    if (index < topFive.length - 1) {
      blocks.push({ type: "divider" });
    }
  });

  return blocks;
}

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] 뉴스 수집 시작`);

  const response = await axios.get<string>(NEWS_URL, { responseType: "text" });
  const rawHtml: string = response.data;

  if (!rawHtml || typeof rawHtml !== "string") {
    console.warn("데이터를 가져오지 못했습니다.");
    return;
  }

  const newsItems = extractNewsItems(rawHtml);
  const topFive = newsItems.slice(0, 5);
  const blocks = buildSlackBlocks(topFive);

  await axios.post(
    SLACK_WEBHOOK_URL,
    { text: "📢 실시간 돈 냄새 나는 증권 뉴스 5", blocks },
    { httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }) }
  );

  console.log(`[${new Date().toISOString()}] 슬랙 전송 완료 (${topFive.length}건)`);
}

// 실행
run().catch((err) => {
  console.error("오류 발생:", err);
  process.exit(1);
});
