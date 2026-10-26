export interface InstagramAuthRecord {
  ig_user_id: string;
  ig_username: string;
  page_id: string;
  page_name: string;
  access_token: string;
  token_type: string;
  expires_at: number;
  connected_at: number;
}

export interface InstagramOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaPageAccountItem {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username: string;
    name?: string;
    profile_picture_url?: string;
  };
}

export interface MetaAccountsResponse {
  data: MetaPageAccountItem[];
}
