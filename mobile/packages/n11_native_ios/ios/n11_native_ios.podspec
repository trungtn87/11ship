Pod::Spec.new do |s|
  s.name             = 'n11_native_ios'
  s.version          = '0.1.0'
  s.summary          = 'iOS native doors of 11Food and 11Ship.'
  s.description      = 'Keychain session token, one-shot location, dialer/link launch and data directory.'
  s.homepage         = 'https://github.com/trungtn87/11ship'
  s.license          = { :type => 'Proprietary' }
  s.author           = { '11Ship' => 'noreply@example.invalid' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.dependency 'FirebaseMessaging', '~> 11.0'
  s.platform         = :ios, '15.0'
  s.swift_version    = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
