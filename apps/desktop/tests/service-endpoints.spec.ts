import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOverlayPatches } from '@aeven/app-boot'

function serviceConfigs(environment: NodeJS.ProcessEnv): Record<string, unknown> {
  const layers = [
    '../../../packages/bundle/base/cordis.patch.yml',
    '../../../packages/bundle/web-app/cordis.patch.yml',
    '../../desktop-host/config/desktop.cordis.patch.yml',
  ].map(path => loadOverlayPatches('desktop endpoints test', fileURLToPath(new URL(path, import.meta.url))))
  const serviceIds = ['identity-user-aeven', 'llm-aeven', 'web-search-deepseek', 'media-aeven', 'account-integrations']
  return Object.fromEntries(composeEntries(layers).flatMap(row =>
    row.id !== undefined && serviceIds.includes(row.id)
      ? [[row.id, interpolate({ process: { env: environment } }, row.config)]]
      : [],
  ))
}

describe('desktop service endpoints', () => {
  it('reaches the deployed services without a shell or home env file', () => {
    const configs = serviceConfigs({})
    expect(configs).toEqual({
      'identity-user-aeven': {
        apiUrl: 'https://aeven.io/api',
        webUrl: 'https://aeven.io',
        mediaUrl: 'https://aeven.io',
        xOAuthUrl: 'https://aeven.io/oauth/x',
        appleOAuthUrl: 'https://aeven.io/oauth/apple',
        googleOAuthUrl: 'https://aeven.io/oauth/google',
        oauthFlow: 'window',
      },
      'llm-aeven': { apiUrl: 'https://aeven.io/api' },
      'media-aeven': { apiUrl: 'https://aeven.io/api' },
      'account-integrations': {
        apiUrl: 'https://aeven.io/api', slackClientId: undefined, slackCallbackPort: 12751,
      },
      'web-search-deepseek': {
        apiKeyEnv: 'AEVEN_TOKEN', baseURL: 'https://aeven.io/api/v1', model: 'Aeven-1.0-Flash',
      },
    })
  })

  it('uses explicit deployment overrides for every service', () => {
    const configs = serviceConfigs({
      AEVEN_API_URL: 'http://localhost:9000',
      AEVEN_WEB_URL: 'http://localhost:3060',
      AEVEN_MEDIA_URL: 'http://localhost:9020',
      AEVEN_OAUTH_X_URL: 'http://localhost:9000/oauth/x',
      AEVEN_OAUTH_APPLE_URL: 'http://localhost:9000/oauth/apple',
      AEVEN_OAUTH_GOOGLE_URL: 'http://localhost:9000/oauth/google',
      SLACK_CLIENT_ID: 'test-slack-client',
    })
    expect(configs['identity-user-aeven']).toEqual({
      apiUrl: 'http://localhost:9000',
      webUrl: 'http://localhost:3060',
      mediaUrl: 'http://localhost:9020',
      xOAuthUrl: 'http://localhost:9000/oauth/x',
      appleOAuthUrl: 'http://localhost:9000/oauth/apple',
      googleOAuthUrl: 'http://localhost:9000/oauth/google',
      oauthFlow: 'window',
    })
    expect(configs['llm-aeven']).toEqual({ apiUrl: 'http://localhost:9000' })
    expect(configs['media-aeven']).toEqual({ apiUrl: 'http://localhost:9000' })
    expect(configs['account-integrations']).toEqual({
      apiUrl: 'http://localhost:9000', slackClientId: 'test-slack-client', slackCallbackPort: 12751,
    })
    expect(configs['web-search-deepseek']).toEqual({
      apiKeyEnv: 'AEVEN_TOKEN', baseURL: 'http://localhost:9000/v1', model: 'Aeven-1.0-Flash',
    })
  })
})
