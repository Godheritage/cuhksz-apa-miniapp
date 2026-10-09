// 云环境 ID。填上后走云开发，群友共用同一份数据。
const cloudEnvId = 'cloudbase-d1gn0bbrp0b86ffd3'
const donationQrPath = '/assets/donate/wechat-pay.jpg'
const donationRecipient = 'valley.(**宜)'

module.exports = {
  cloudEnvId,
  useMock: !cloudEnvId,
  donationQrPath,
  donationRecipient,
}
