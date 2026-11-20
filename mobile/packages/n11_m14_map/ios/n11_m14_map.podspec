Pod::Spec.new do |s|
  s.name             = 'n11_m14_map'
  s.version          = '0.1.0'
  s.summary          = 'Offline Cao Bang map view (MapLibre) for 11Food and 11Ship on iOS.'
  s.description      = 'The iOS counterpart of the Android M14MapFactory. The map package (ios/caobang) is copied here by mobile/tool/prepare-ios.sh from the committed package in gps-test; it is not stored twice in git.'
  s.homepage         = 'https://github.com/trungtn87/11ship'
  s.license          = { :type => 'Proprietary' }
  s.author           = { '11Ship' => 'noreply@example.invalid' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.resources        = ['caobang']
  s.dependency 'Flutter'
  s.dependency 'MapLibre'
  s.platform         = :ios, '13.0'
  s.swift_version    = '5.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
