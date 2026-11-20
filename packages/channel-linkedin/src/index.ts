export { createLinkedinChannel, LINKEDIN_POST_SEARCH_ACTOR_ID } from './channel.ts';
export type {
  LinkedinChannel,
  LinkedinChannelError,
  LinkedinChannelOptions,
  PostedLimit,
  SearchPostsOptions,
} from './channel.ts';
export type { LinkedinPost, LinkedinPostAuthor } from './parse-post.ts';
export { ActorOutputError } from './errors/actor-output-error.ts';
export { ActorRunError } from './errors/actor-run-error.ts';
export { ApifyRequestError } from './errors/apify-request-error.ts';
