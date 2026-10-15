import json
import re
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
    nodes = [n for n in root.iter('node') if n.get('text') == text]
    assert nodes, text
    x1,y1,x2,y2 = map(int,re.findall(r'\d+', nodes[-1].get('bounds')))
    adb('shell', 'input', 'tap', str((x1+x2)//2),str((y1+y2)//2))


try:
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
    # Chosen points are explicit map selections, not GPS injections.
    adb('shell','input','tap',str(im.width//2),str(int(im.height*.30)))
    time.sleep(2)
    tap_text(ui('choose-start'),'Điểm đầu (A)')
    adb('shell','input','tap',str(int(im.width*.65)),str(int(im.height*.40)))
    time.sleep(2)
    tap_text(ui('choose-end'),'Điểm cuối (B)')
    root=ui('two-points')
    tap_text(root,'Tính tuyến')
    time.sleep(2)
    root=ui('offline-route-request')
    assert any('Cần mạng để tính tuyến mới' in n.get('text','') for n in root.iter('node'))
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
    log=adb('logcat','-d').decode(errors='replace')
    assert 'FATAL EXCEPTION' not in log, log[-4000:]
    report={'signed_apk_installed':True,'airplane_mode':True,'osm_river_pixels':water,'offline_map_rendered':True,'two_pins_selected':True,'offline_route_message':True,'permission_denied_without_recording':True,'gps_injected':False,'physical_gps_tested':False,'build_info':json.loads(Path('build-info.json').read_text())}
    (out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
finally:
    try:
        (out/'logcat.txt').write_bytes(adb('logcat','-d'))
    except Exception:
        pass
