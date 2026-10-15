import math
import json
import re
import sqlite3
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

out = Path('runtime-proof')
out.mkdir(exist_ok=True)


def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=60)


def ui(name):
    adb('shell', 'uiautomator', 'dump', '/sdcard/m14-ui.xml')
    data = adb('shell', 'cat', '/sdcard/m14-ui.xml')
    (out / (name+'.xml')).write_bytes(data)
    return ET.fromstring(data)


def tap_text(root, text):
    nodes = [n for n in root.iter('node') if n.get('text','').casefold() == text.casefold()]
    assert nodes, text
    x1,y1,x2,y2 = map(int,re.findall(r'\d+', nodes[-1].get('bounds')))
    adb('shell', 'input', 'tap', str((x1+x2)//2),str((y1+y2)//2))


try:
    adb('root')  # Disposable AOSP emulator only; app itself never requires root.
    adb('wait-for-device')
    adb('install', '-r', '11Ship-GPS-Test.apk')
    adb('shell', 'settings', 'put', 'global', 'airplane_mode_on', '1')
    adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', 'true')
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    adb('shell', 'input', 'keyevent', '82')
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-W', '-n', 'vn.eleven.ship.gpstest/vn.eleven.gpstest.MainActivity')
    time.sleep(20)
    root=ui('offline-main')
    labels=[n.get('text','') for n in root.iter('node')]
    assert '11Ship GPS Test' in labels, labels
    assert not any('chưa sử dụng được' in text or 'Gói bản đồ chưa' in text for text in labels), labels
    assert any('Cần mạng để tính tuyến mới' in text for text in labels), labels
    assert any('Chưa lấy được vị trí' in text for text in labels), labels
    assert 'Bắt đầu ghi' in labels, labels
    png=adb('exec-out','screencap','-p')
    (out/'offline-main.png').write_bytes(png)
    im=Image.open(out/'offline-main.png').convert('RGB')
    crop=im.crop((0,int(im.height*.16),im.width,int(im.height*.56)))
    colors=crop.getcolors(crop.width*crop.height)
    # Real OSM water fill is distinctive; a blank mock/background cannot satisfy this check.
    water=sum(n for n,c in colors if abs(c[0]-157)<5 and abs(c[1]-207)<5 and abs(c[2]-226)<5)
    assert water>100, ('No OSM river rendered',water)
    # Project real OSM road vertices into the known initial MapLibre camera.
    def bounds(n):
        return tuple(map(int,re.findall(r'\d+',n.get('bounds'))))
    gps_node=next(n for n in root.iter('node') if 'Chưa lấy được vị trí' in n.get('text',''))
    start_node=next(n for n in root.iter('node') if 'Điểm đầu: chạm bản đồ' in n.get('text',''))
    center_y=(bounds(gps_node)[3]+bounds(start_node)[1])/2
    density_text=adb('shell','wm','density').decode()
    density=int(re.findall(r'\d+',density_text)[-1])/160
    world=512*(2**12)*density
    def merc_y(lat):
        return .5-math.log(math.tan(math.pi/4+math.radians(lat)/2))/(2*math.pi)
    def select(lat,lon,label,name):
        x=im.width/2+world*(lon-106.257)/360
        y=center_y+world*(merc_y(lat)-merc_y(22.665))
        adb('shell','input','tap',str(round(x)),str(round(y)))
        time.sleep(2)
        tap_text(ui(name),label)
    select(22.6672017,106.2638557,'Điểm đầu (A)','choose-start')
    select(22.6566272,106.2585301,'Điểm cuối (B)','choose-end')
    root=ui('two-points')
    tap_text(root,'Tính tuyến')
    time.sleep(2)
    root=ui('offline-route-request')
    assert any('Cần mạng để tính tuyến mới' in n.get('text','') for n in root.iter('node'))
    # Exercise the Android HTTPS client against the real isolated Render service.
    adb('shell','settings','put','global','airplane_mode_on','0')
    adb('shell','am','broadcast','-a','android.intent.action.AIRPLANE_MODE','--ez','state','false')
    adb('shell','svc','wifi','enable')
    for _ in range(12):
        time.sleep(5)
        root=ui('network-ready')
        if any('Có mạng' in n.get('text','') for n in root.iter('node')):
            break
    else:
        raise AssertionError('Emulator Wi-Fi did not validate Internet access')
    tap_text(root,'Tính tuyến')
    for _ in range(24):
        time.sleep(5)
        root=ui('online-route')
        results=[n.get('text','') for n in root.iter('node') if n.get('text','').startswith('Tuyến dự tính:')]
        if results:
            break
    else:
        raise AssertionError([n.get('text','') for n in root.iter('node')])
    online_result=results[0]
    (out/'online-route.png').write_bytes(adb('exec-out','screencap','-p'))
    adb('shell','settings','put','global','airplane_mode_on','1')
    adb('shell','am','broadcast','-a','android.intent.action.AIRPLANE_MODE','--ez','state','true')
    adb('shell','svc','wifi','disable')
    adb('shell','am','force-stop','vn.eleven.ship.gpstest')
    adb('shell','am','start','-W','-n','vn.eleven.ship.gpstest/vn.eleven.gpstest.MainActivity')
    time.sleep(12)
    root=ui('offline-cached-route')
    assert any(n.get('text','').startswith('Tuyến dự tính đã lưu:') for n in root.iter('node'))
    (out/'offline-cached-route.png').write_bytes(adb('exec-out','screencap','-p'))
    # Install the newer build over the old one with the same persistent signer.
    adb('install','-r','updated-apk/11Ship-GPS-Test.apk')
    adb('shell','am','start','-W','-n','vn.eleven.ship.gpstest/vn.eleven.gpstest.MainActivity')
    time.sleep(10)
    root=ui('updated-offline-cached-route')
    assert any(n.get('text','').startswith('Tuyến dự tính đã lưu:') for n in root.iter('node'))
    (out/'updated-offline-cached-route.png').write_bytes(adb('exec-out','screencap','-p'))
    tap_text(root,'Bắt đầu ghi')
    time.sleep(1)
    tap_text(ui('consent'),'Bắt đầu')
    time.sleep(2)
    permission=ui('permission')
    tap_text(permission,'Deny')
    time.sleep(2)
    root=ui('denied')
    assert any('Bản đồ và lịch sử đã lưu vẫn dùng được' in n.get('text','') for n in root.iter('node'))
    services=adb('shell','dumpsys','activity','services','vn.eleven.ship.gpstest').decode()
    assert 'ServiceRecord' not in services, services
    (out/'denied.png').write_bytes(adb('exec-out','screencap','-p'))
    tap_text(root,'Đóng')
    # Foreground lifecycle with GPS explicitly OFF: never treat virtual GPS as a real fix.
    adb('shell','pm','grant','vn.eleven.ship.gpstest','android.permission.ACCESS_COARSE_LOCATION')
    adb('shell','pm','grant','vn.eleven.ship.gpstest','android.permission.ACCESS_FINE_LOCATION')
    adb('shell','settings','put','secure','location_mode','0')
    time.sleep(2)
    tap_text(ui('gps-off'),'Bắt đầu ghi')
    time.sleep(1)
    tap_text(ui('gps-off-consent'),'Bắt đầu')
    time.sleep(4)
    services=adb('shell','dumpsys','activity','services','vn.eleven.ship.gpstest').decode()
    assert 'RecorderService' in services and 'isForeground=true' in services, services
    root=ui('recording-gps-disabled')
    assert any('GPS đang tắt' in n.get('text','') for n in root.iter('node'))
    adb('shell','input','keyevent','26')
    time.sleep(5)
    services=adb('shell','dumpsys','activity','services','vn.eleven.ship.gpstest').decode()
    assert 'RecorderService' in services and 'isForeground=true' in services
    adb('shell','input','keyevent','26')
    adb('shell','input','keyevent','82')
    adb('shell','am','start','-W','-n','vn.eleven.ship.gpstest/vn.eleven.gpstest.MainActivity')
    time.sleep(3)
    tap_text(ui('stop-recording'),'Dừng ghi')
    time.sleep(65)
    services=adb('shell','dumpsys','activity','services','vn.eleven.ship.gpstest').decode()
    assert 'RecorderService' not in services, services
    prefs=adb('shell','cat','/data/data/vn.eleven.ship.gpstest/shared_prefs/m14-gps.xml').decode()
    assert 'name="lat"' not in prefs, prefs
    # Exercise SQLite expiry with explicit test fixtures, not with a mock GPS provider.
    adb('shell','am','force-stop','vn.eleven.ship.gpstest')
    adb('pull','/data/data/vn.eleven.ship.gpstest/databases/m14-history.db',str(out/'retention-fixture.db'))
    fixture=out/'retention-fixture.db'
    conn=sqlite3.connect(fixture)
    now=int(time.time()*1000)
    conn.execute('DELETE FROM points')
    for offset in (25*3600000,3600000):
        conn.execute('INSERT INTO points(lat,lon,accuracy,time,segment) VALUES(?,?,?,?,?)',(22.665,106.257,5,now-offset,now-offset))
    conn.commit();conn.close()
    adb('push',str(fixture),'/data/data/vn.eleven.ship.gpstest/databases/m14-history.db')
    adb('shell','am','start','-W','-n','vn.eleven.ship.gpstest/vn.eleven.gpstest.MainActivity')
    time.sleep(5)
    adb('pull','/data/data/vn.eleven.ship.gpstest/databases/m14-history.db',str(out/'retention-result.db'))
    conn=sqlite3.connect(out/'retention-result.db')
    assert conn.execute('SELECT count(*) FROM points').fetchone()[0]==1
    conn.close()
    tap_text(ui('history-before-delete'),'Lịch sử')
    time.sleep(1)
    tap_text(ui('history-options'),'Tùy chọn')
    time.sleep(1)
    tap_text(ui('history-menu'),'Xóa toàn bộ lịch sử')
    time.sleep(1)
    tap_text(ui('history-delete-confirm'),'Xóa')
    time.sleep(2)
    adb('pull','/data/data/vn.eleven.ship.gpstest/databases/m14-history.db',str(out/'history-cleared.db'))
    conn=sqlite3.connect(out/'history-cleared.db')
    assert conn.execute('SELECT count(*) FROM points').fetchone()[0]==0
    conn.close()
    log=adb('logcat','-d').decode(errors='replace')
    assert 'FATAL EXCEPTION' not in log, log[-4000:]
    report={'signed_apk_installed':True,'airplane_mode':True,'osm_river_pixels':water,'offline_map_rendered':True,'two_pins_selected':True,'android_online_route':online_result,'offline_cached_route_after_restart':True,'offline_route_message':True,'permission_denied_without_recording':True,'gps_injected':False,'physical_gps_tested':False,'update_keeps_route_cache':True,'foreground_survives_screen_lock_with_gps_off':True,'stop_stays_stopped_after_65_seconds':True,'gps_disabled_reported':True,'retention_25h_deleted_1h_kept_using_database_fixtures':True,'clear_history_works':True,'old_build_info':json.loads(Path('build-info.json').read_text()),'build_info':json.loads(Path('updated-apk/build-info.json').read_text())}
    (out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
finally:
    try:
        (out/'logcat.txt').write_bytes(adb('logcat','-d'))
    except Exception:
        pass
