import { defineAuth } from '@aws-amplify/backend';

/**
 * 認証設定
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // ユーザーグループ
  groups: ['admin', 'viewer'],
});
