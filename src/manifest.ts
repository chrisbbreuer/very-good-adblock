import { extensionDescription, extensionName, staticRulesetId } from './shared/constants'

export interface ManifestInput {
  version: string
}

export function buildManifest(input: ManifestInput): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: extensionName,
    description: extensionDescription,
    version: input.version,
    action: {
      default_title: extensionName,
      default_popup: 'popup.html',
    },
    options_page: 'options.html',
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    permissions: ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'storage', 'tabs', 'scripting', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content.js'],
        run_at: 'document_start',
      },
    ],
    declarative_net_request: {
      rule_resources: [
        {
          id: staticRulesetId,
          enabled: true,
          path: 'rules/static.json',
        },
      ],
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'`,
    },
  }
}
