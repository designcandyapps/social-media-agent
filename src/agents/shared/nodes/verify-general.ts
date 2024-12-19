import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { GeneratePostAnnotation } from "../../generate-post/generate-post-state.js";
import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";
import { FireCrawlLoader } from "@langchain/community/document_loaders/web/firecrawl";
import { LANGCHAIN_PRODUCTS_CONTEXT } from "../../generate-post/prompts.js";
import { VerifyContentAnnotation } from "../shared-state.js";
import { RunnableLambda } from "@langchain/core/runnables";
import { getPageText } from "../../utils.js";

type VerifyGeneralContentReturn = {
  relevantLinks: (typeof GeneratePostAnnotation.State)["relevantLinks"];
  pageContents: (typeof GeneratePostAnnotation.State)["pageContents"];
};

const RELEVANCY_SCHEMA = z
  .object({
    reasoning: z
      .string()
      .describe(
        "Reasoning for why the webpage is or isn't relevant to LangChain's products.",
      ),
    relevant: z
      .boolean()
      .describe(
        "Whether or not the webpage is relevant to LangChain's products.",
      ),
  })
  .describe("The relevancy of the content to LangChain's products.");

const VERIFY_LANGCHAIN_RELEVANT_CONTENT_PROMPT = `You are a highly regarded marketing employee at LangChain.
You're provided with a webpage containing content a third party submitted to LangChain claiming it's relevant and implements LangChain's products.
Your task is to carefully read over the entire page, and determine whether or not the content actually implements and is relevant to LangChain's products.
You're doing this to ensure the content is relevant to LangChain, and it can be used as marketing material to promote LangChain.

For context, LangChain has three main products you should be looking out for:
${LANGCHAIN_PRODUCTS_CONTEXT}

Given this context, examine the webpage content closely, and determine if the content implements LangChain's products.
You should provide reasoning as to why or why not the content implements LangChain's products, then a simple true or false for whether or not it implements some.`;

export async function getUrlContents(url: string): Promise<string> {
  const loader = new FireCrawlLoader({
    url,
    mode: "scrape",
  });
  const docs = await loader.load();
  const docsText = docs.map((d) => d.pageContent).join("\n");
  if (docsText.length) {
    return docsText;
  }

  const text = await getPageText(url);
  if (text) {
    return text;
  }
  throw new Error(`Failed to fetch content from ${url}.`);
}

export async function verifyGeneralContentIsRelevant(
  content: string,
): Promise<boolean> {
  const relevancyModel = new ChatAnthropic({
    model: "claude-3-5-sonnet-20241022",
    temperature: 0,
  }).withStructuredOutput(RELEVANCY_SCHEMA, {
    name: "relevancy",
  });

  const { relevant } = await relevancyModel
    .withConfig({
      runName: "check-general-relevancy-model",
    })
    .invoke([
      {
        role: "system",
        content: VERIFY_LANGCHAIN_RELEVANT_CONTENT_PROMPT,
      },
      {
        role: "user",
        content: content,
      },
    ]);
  return relevant;
}

/**
 * Verifies the content provided is relevant to LangChain products.
 */
/**
 * Verifies if the general content from a provided URL is relevant to LangChain products.
 *
 * @param state - The current state containing the link to verify.
 * @param _config - Configuration for the LangGraph runtime (unused in this function).
 * @returns An object containing relevant links and page contents if the content is relevant;
 * otherwise, returns empty arrays.
 */
export async function verifyGeneralContent(
  state: typeof VerifyContentAnnotation.State,
  _config: LangGraphRunnableConfig,
): Promise<VerifyGeneralContentReturn> {
  const pageContent = await new RunnableLambda<string, string>({
    func: getUrlContents,
  })
    .withConfig({ runName: "get-url-contents" })
    .invoke(state.link);
  const relevant = await verifyGeneralContentIsRelevant(pageContent);

  if (relevant) {
    return {
      relevantLinks: [state.link],
      pageContents: [pageContent],
    };
  }

  // Not relevant, return empty arrays so this URL is not included.
  return {
    relevantLinks: [],
    pageContents: [],
  };
}