export { createLinkedinChannel, LINKEDIN_POST_SEARCH_ACTOR_ID } from './channel.ts';
export type {
  LinkedinChannel,
  LinkedinChannelError,
  LinkedinChannelOptions,
  PostedLimit,
  SearchPostsOptions,
} from './channel.ts';
export type { LinkedinPost, LinkedinPostAuthor } from './parse-post.ts';
export { ActorOutputError, ActorRunError, ApifyRequestError } from '@job-market/apify';
