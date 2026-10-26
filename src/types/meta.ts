/**
 * Meta Graph API and Webhook event payload definitions for Instagram Graph API.
 */

export interface InstagramCommentValue {
  id: string;
  text: string;
  from: {
    id: string;
    username?: string;
  };
  media: {
    id: string;
    media_product_type?: string;
  };
  parent_id?: string;
  timestamp?: string;
}

export interface InstagramChange {
  field: 'comments' | 'mentions' | string;
  value: InstagramCommentValue | any;
}

export interface InstagramMessageAttachment {
  type: string;
  payload: {
    url?: string;
    [key: string]: any;
  };
}

export interface InstagramMessageContent {
  mid: string;
  text?: string;
  is_echo?: boolean;
  attachments?: InstagramMessageAttachment[];
  quick_reply?: {
    payload: string;
  };
}

export interface InstagramMessagingItem {
  sender: {
    id: string;
  };
  recipient: {
    id: string;
  };
  timestamp: number;
  message?: InstagramMessageContent;
}

export interface InstagramWebhookEntry {
  id: string;
  time: number;
  changes?: InstagramChange[];
  messaging?: InstagramMessagingItem[];
}

export interface InstagramWebhookPayload {
  object: 'instagram' | 'page';
  entry: InstagramWebhookEntry[];
}

export interface MetaContainerResponse {
  id: string;
}

export type MetaContainerStatusCode =
  | 'EXPIRED'
  | 'ERROR'
  | 'FINISHED'
  | 'IN_PROGRESS'
  | 'PUBLISHED';

export interface MetaContainerStatusResponse {
  id: string;
  status_code: MetaContainerStatusCode;
  status?: string;
}

export interface MetaMediaPublishResponse {
  id: string;
}

export interface MetaCommentReplyResponse {
  id: string;
}

export interface MetaSendDMResponse {
  recipient_id: string;
  message_id: string;
}
