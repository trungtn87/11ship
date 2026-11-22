Pod::Spec.new do |s|
  s.name             = 'n11_m14'
  s.version          = '0.1.0'
  s.summary          = '11Ship location sharing on iOS (M14).'
  s.description      = 'The iOS counterpart of M14Plugin/ShipLocationService: foreground-started, background-capable location sharing that sends only the latest position.'
  s.homepage         = 'https://github.com/trungtn87/11ship'
  s.license          = { :type => 'Proprietary' }
  s.author           = { '11Ship' => 'noreply@example.invalid' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.platform         = :ios, '15.0'
  s.swift_version    = '5.0'
  s.resource_bundles = { 'n11_m14_privacy' => ['Resources/PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
