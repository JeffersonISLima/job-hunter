declare module 'node-telegram-bot-api' {
  interface SendMessageOptions {
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
    disable_web_page_preview?: boolean;
  }

  export default class TelegramBot {
    constructor(token: string, options?: { polling?: boolean });
    sendMessage(
      chatId: string | number,
      text: string,
      options?: SendMessageOptions
    ): Promise<unknown>;
  }
}
