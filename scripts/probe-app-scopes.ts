// Print just the app's granted scopes, so we know which API 权限 it already holds.
import { credentials, larkClient } from './env.mjs'

const { appId } = credentials()
const client = larkClient()

const res = await client.request({
  method: 'GET',
  url: `/open-apis/application/v6/applications/${appId}`,
  params: { lang: 'zh_cn' },
})
const app = res?.data?.app ?? {}
console.log('app_name      =', app.app_name)
console.log('online        =', app.online_version_id ? '已发布' : '未发布')
console.log('scopes (' + (app.scopes?.length ?? 0) + '):')
for (const scope of app.scopes ?? []) {
  console.log('  -', scope.scope, '|', scope.description ?? '', '|', scope.grant_status ?? '')
}
console.log('\n通讯录授权范围:')
const scopes = await client.request({ method: 'GET', url: '/open-apis/contact/v3/scopes', params: { page_size: 50 } })
console.log('  user_ids =', JSON.stringify(scopes?.data?.user_ids))
console.log('  department_ids =', JSON.stringify(scopes?.data?.department_ids))
