export interface QuotedMessage {
  id: string;
  seq?: number;
  authorId?: string;
  text?: string;
  attachmentNames?: string[];
  deleted?: boolean;
  unavailable?: boolean;
}
