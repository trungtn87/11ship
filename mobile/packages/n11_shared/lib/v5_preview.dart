import 'package:flutter/material.dart';
import 'package:n11_shared/n11_shared.dart';

/// UI-only V5 demo. Deliberately disconnected from auth, GPS, orders and money.
class V5PreviewApp extends StatefulWidget {
  const V5PreviewApp({
    super.key,
    required this.isFood,
    this.shopOwner = true,
    this.showFoodBanner = true,
    this.initiallyOnline = true,
    this.showThirdOrder = true,
    this.cardRadius = 17,
    this.mapHeight = 168,
    this.accentColor = N11Colors.yellow,
  });
  final bool isFood;
  final bool shopOwner;
  /// Design-only parameters exposed through upstream Widgetbook Knobs.
  final bool showFoodBanner;
  final bool initiallyOnline;
  final bool showThirdOrder;
  final double cardRadius;
  final double mapHeight;
  final Color accentColor;
  @override
  State<V5PreviewApp> createState() => _V5PreviewAppState();
}
class _V5PreviewAppState extends State<V5PreviewApp> {
  int selected = 0;
  late bool online;
  @override
  void initState() {
    super.initState();
    online = widget.initiallyOnline;
  }

  @override
  void didUpdateWidget(covariant V5PreviewApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initiallyOnline != widget.initiallyOnline) {
      online = widget.initiallyOnline;
    }
  }
  static const orange = Color(0xFFED6A00);
  static const shadow = [BoxShadow(color: Color(0x13000000), blurRadius: 12, offset: Offset(0, 3))];
  List<(String, IconData)> get tabs => widget.isFood ? [
    ('Trang chủ', Icons.home_rounded), ('Đơn hàng', Icons.receipt_long_outlined),
    if (widget.shopOwner) ('Quán', Icons.storefront_outlined),
    ('Tài khoản', Icons.person_outline_rounded),
  ] : [
    ('Trang chủ', Icons.home_rounded), ('Đơn hàng', Icons.receipt_long_outlined),
    ('Thu nhập', Icons.bar_chart_outlined), ('Thông báo', Icons.notifications_none_rounded),
    ('Tài khoản', Icons.person_outline_rounded),
  ];
  Text _tx(String s, double size, {Color color=N11Colors.black, FontWeight weight=FontWeight.w600, int max=1}) =>
      Text(s, maxLines:max, overflow:TextOverflow.ellipsis,
        style: TextStyle(fontFamily:kFontFamily, package:'n11_shared', fontSize:size,
          fontWeight:weight, color:color, height:1.2));
  // Always reuse the Owner-approved PNG logos from the production BrandLogo.
  // Do not replace them with a text redraw or generated imitation.
  Widget _logo(bool food) => SizedBox(
    width: 154,
    height: 62,
    child: Align(
      alignment: Alignment.centerLeft,
      child: BrandLogo(brand: food ? foodBrand : shipBrand, height: 58),
    ),
  );
  Widget _header(bool food) => SizedBox(height:82,child:Padding(
    padding:const EdgeInsets.symmetric(horizontal:15),
    child:Row(children:[
      _logo(food), const Spacer(),
      Stack(children:[
        Container(width:43,height:43,decoration:BoxDecoration(color:Colors.white,shape:BoxShape.circle,boxShadow:shadow),
          child:const Icon(Icons.notifications_none_rounded,size:25)),
        const Positioned(right:5,top:3,child:CircleAvatar(radius:5,backgroundColor:Colors.red)),
      ]),
      if (!food) ...[const SizedBox(width:9),const CircleAvatar(radius:22,backgroundColor:Color(0xFFF0F1F5),
        child:Icon(Icons.person_outline_rounded,color:N11Colors.black))],
    ]),
  ));
  Widget _bottom() => Container(
    height:68, decoration:const BoxDecoration(color:Colors.white,border:Border(top:BorderSide(color:Color(0xFFEEF0F2)))),
    child:Row(children:[
      for (var i=0;i<tabs.length;i++) Expanded(child:InkWell(
        key:Key('v5-tab-$i'), onTap:()=>setState(()=>selected=i),
        child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
          Container(width:54,height:35,
            decoration:BoxDecoration(color:i==selected?N11Colors.yellowSoft:Colors.transparent,
              borderRadius:BorderRadius.circular(22)),
            child:Icon(tabs[i].$2,size:24,color:i==selected?orange:N11Colors.ink2)),
          const SizedBox(height:1),
          FittedBox(fit:BoxFit.scaleDown,child:_tx(tabs[i].$1,11,
              color:i==selected?orange:N11Colors.ink2,weight:i==selected?FontWeight.w800:FontWeight.w500)),
        ]),
      )),
    ]),
  );
  Widget _category(String name, IconData icon, bool active) => Expanded(
    child:Container(margin:const EdgeInsets.symmetric(horizontal:3),height:74,
      decoration:BoxDecoration(color:active?const Color(0xFFFFDE52):Colors.white,
        borderRadius:BorderRadius.circular(15),boxShadow:shadow),
      child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
        Icon(icon,size:29),const SizedBox(height:7),
        FittedBox(fit:BoxFit.scaleDown,child:_tx(name,10)),
      ]),
    ),
  );
  Widget _foodCard(String name,String category,String rating,String distance,IconData symbol,Color bg) => Container(
    margin:const EdgeInsets.fromLTRB(15,0,15,9),height:122,
    padding:const EdgeInsets.all(9),
    decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(widget.cardRadius),boxShadow:shadow),
    child:Row(children:[
      Container(width:75,height:94,decoration:BoxDecoration(color:bg,borderRadius:BorderRadius.circular(13)),
        child:Icon(symbol,size:44,color:N11Colors.black)),
      const SizedBox(width:12),
      Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,mainAxisAlignment:MainAxisAlignment.center,children:[
        _tx(name,14),const SizedBox(height:5),
        Row(children:[const Icon(Icons.star_rounded,size:16,color:N11Colors.yellow),
          _tx(rating,12,color:N11Colors.ink2)]),
        const SizedBox(height:4),_tx(category,11,color:N11Colors.ink2),
        const SizedBox(height:3),Row(children:[const Icon(Icons.place,size:13,color:N11Colors.ink2),
          _tx(distance,11,color:N11Colors.ink2)]),
        const SizedBox(height:5),
        Container(padding:const EdgeInsets.symmetric(horizontal:10,vertical:4),
          decoration:BoxDecoration(color:const Color(0xFFE5F8EA),borderRadius:BorderRadius.circular(20)),
          child:_tx('Đang mở cửa',11,color:N11Colors.success)),
      ])),
      const SizedBox(width:7),
      Container(width:63,height:94,decoration:BoxDecoration(
          borderRadius:BorderRadius.circular(13),
          gradient:LinearGradient(colors:[bg,const Color(0xFFFFD78D)],begin:Alignment.topLeft,end:Alignment.bottomRight)),
        child:Icon(Icons.restaurant_menu_rounded,size:32,color:orange)),
    ]),
  );
  Widget _foodHome() => ListView(key:const Key('v5-food-home'),children:[
    _header(true),
    Container(margin:const EdgeInsets.symmetric(horizontal:13),padding:const EdgeInsets.all(10),
      decoration:BoxDecoration(color:widget.accentColor,borderRadius:BorderRadius.circular(25)),
      child:Column(children:[
        Row(children:[
          Expanded(child:Container(height:47,padding:const EdgeInsets.symmetric(horizontal:15),
            decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(16)),
            child:Row(children:[const Icon(Icons.search_rounded,size:24),const SizedBox(width:10),
              Expanded(child:_tx('Tìm quán hoặc món ăn...',13,color:N11Colors.ink2))]))),
          const SizedBox(width:10),
          Container(width:47,height:47,decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(16)),
            child:const Icon(Icons.tune_rounded)),
        ]),
        const SizedBox(height:13),
        Row(children:[
          _category('Đồ ăn',Icons.restaurant,true),
          _category('Trà sữa',Icons.local_drink_outlined,false),
          _category('Cơm',Icons.rice_bowl_outlined,false),
          _category('Bánh ngọt',Icons.cake_outlined,false),
          _category('Đồ uống',Icons.coffee_outlined,false),
        ]),
      ])),
    if (widget.showFoodBanner) ...[
    const SizedBox(height:14),
    Container(height:111,margin:const EdgeInsets.symmetric(horizontal:15),
      decoration:BoxDecoration(
        gradient:const LinearGradient(colors:[Color(0xFFFFF3B0),Color(0xFFFFD84D)]),
        borderRadius:BorderRadius.circular(16),boxShadow:shadow),
      child:Row(children:[
        Padding(padding:const EdgeInsets.fromLTRB(16,12,0,9),child:Column(
          crossAxisAlignment:CrossAxisAlignment.start,children:[
          _tx('Món ngon',18,color:orange,weight:FontWeight.w800),
          _tx('Cao Bằng',26,weight:FontWeight.w800),
          const SizedBox(height:5),_tx('Giao nhanh tận nơi',11,color:N11Colors.ink2),
        ])),
        const Spacer(),const Padding(padding:EdgeInsets.only(right:15),
          child:Icon(Icons.ramen_dining_rounded,size:77,color:Color(0xFFC15C13))),
      ])),
    ],
    const SizedBox(height:18),
    Padding(padding:const EdgeInsets.fromLTRB(17,0,17,11),child:Row(children:[
      Expanded(child:_tx('Quán gần bạn',22,weight:FontWeight.w800)),
      _tx('Xem tất cả',13,color:orange,weight:FontWeight.w800),
    ])),
    _foodCard('Xanh Ngọt - Tráng miệng','Tráng miệng · Đồ uống','4.8 (120)','1,3 km',Icons.local_cafe_outlined,const Color(0xFFFFEDD4)),
    _foodCard('Bún Phở Hà Nội','Bún phở · Cơm','4.6 (89)','2,1 km',Icons.ramen_dining,const Color(0xFFFFF3D5)),
    _foodCard('Ốc 11','Hải sản · Đồ nhậu','5.0 (56)','2,4 km',Icons.set_meal_outlined,const Color(0xFFFFF2C1)),
  ]);
  Widget _shipCard(String name,String address,String fee,IconData symbol,Color bg) => Container(
    margin:const EdgeInsets.fromLTRB(16,0,16,9),height:108,padding:const EdgeInsets.all(10),
    decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(17),boxShadow:shadow),
    child:Row(children:[
      Container(width:75,height:86,decoration:BoxDecoration(color:bg,borderRadius:BorderRadius.circular(13)),
        child:Icon(symbol,size:43,color:orange)),
      const SizedBox(width:11),
      Expanded(child:Column(mainAxisAlignment:MainAxisAlignment.center,
        crossAxisAlignment:CrossAxisAlignment.start,children:[
          _tx(name,14),const SizedBox(height:7),
          Row(children:[const Icon(Icons.location_on,size:15,color:orange),
            const SizedBox(width:2),Expanded(child:_tx(address,11,color:N11Colors.ink2))]),
          const SizedBox(height:9),
          Container(padding:const EdgeInsets.symmetric(horizontal:9,vertical:5),
            decoration:BoxDecoration(color:const Color(0xFFFFF4D5),borderRadius:BorderRadius.circular(16)),
            child:_tx('Giao đồ ăn',11,color:const Color(0xFFB67621))),
        ])),
      Column(crossAxisAlignment:CrossAxisAlignment.end,mainAxisAlignment:MainAxisAlignment.spaceEvenly,children:[
        _tx(fee,17,color:orange,weight:FontWeight.w800),
        Container(padding:const EdgeInsets.symmetric(horizontal:11,vertical:8),
          decoration:BoxDecoration(color:N11Colors.yellow,borderRadius:BorderRadius.circular(25)),
          child:Row(children:[_tx('Xem đơn',11,weight:FontWeight.w800),
            const Icon(Icons.chevron_right,size:19)])),
      ]),
    ]),
  );
  Widget _shipHome() => ListView(key:const Key('v5-ship-home'),children:[
    _header(false),
    Padding(padding:const EdgeInsets.fromLTRB(16,8,16,15),child:Row(children:[
      Expanded(child:_tx('Nhận đơn giao hàng',18,weight:FontWeight.w800)),
      InkWell(key:const Key('v5-online-toggle'),onTap:()=>setState(()=>online=!online),
        child:Container(padding:const EdgeInsets.symmetric(horizontal:13,vertical:11),
          decoration:BoxDecoration(color:online?const Color(0xFF00A741):N11Colors.yellowSoft,
            borderRadius:BorderRadius.circular(25)),
          child:Row(children:[
            Icon(Icons.power_settings_new,size:21,color:online?Colors.white:N11Colors.black),
            const SizedBox(width:6),
            _tx(online?'Tắt nhận đơn':'Bật nhận đơn',12.5,
              weight:FontWeight.w800,color:online?Colors.white:N11Colors.black),
          ]))),
    ])),
    Container(margin:const EdgeInsets.symmetric(horizontal:16),
      padding:const EdgeInsets.fromLTRB(11,12,11,11),
      decoration:BoxDecoration(color:N11Colors.bg,borderRadius:BorderRadius.circular(18),boxShadow:shadow),
      child:Column(children:[
        Row(children:[Expanded(child:_tx('Khu vực nhận đơn',16,weight:FontWeight.w800)),
          Container(padding:const EdgeInsets.symmetric(horizontal:11,vertical:6),
            decoration:BoxDecoration(color:N11Colors.yellowSoft,borderRadius:BorderRadius.circular(20)),
            child:_tx('Bán kính 3 km',11.5))]),
        const SizedBox(height:11),
        Container(height:widget.mapHeight,width:double.infinity,clipBehavior:Clip.antiAlias,
          decoration:BoxDecoration(color:const Color(0xFFEAF1E9),borderRadius:BorderRadius.circular(14)),
          child:CustomPaint(painter:_PreviewMapPainter())),
      ])),
    const SizedBox(height:21),
    Padding(padding:const EdgeInsets.fromLTRB(16,0,16,12),child:Row(children:[
      Expanded(child:_tx('Đơn chờ nhận',22,weight:FontWeight.w800)),
      _tx('3 đơn',16,color:orange,weight:FontWeight.w800),
    ])),
    _shipCard('Quán 11','0,8 km · Đường Kim Đồng','25.000đ',Icons.ramen_dining,const Color(0xFFFFE8AE)),
    _shipCard('Bún chả Hương Việt','1,5 km · Phố Pác Bó','32.000đ',Icons.restaurant_menu,const Color(0xFFFFF1CF)),
    if (widget.showThirdOrder) _shipCard('Cà phê 1986','2,3 km · Tổ 7, Sông Hiến','18.000đ',Icons.local_cafe,const Color(0xFFF5DEB1)),
  ]);
  Widget _other(String name,IconData icon) => Column(children:[
    _header(widget.isFood),const SizedBox(height:50),
    Icon(icon,color:N11Colors.yellow,size:74),const SizedBox(height:17),
    _tx(name,26,weight:FontWeight.w800),const SizedBox(height:14),
    Padding(padding:const EdgeInsets.symmetric(horizontal:36),
      child:Text('V5 · Bản xem trước UI và điều hướng, không kết nối dữ liệu.',
        textAlign:TextAlign.center,style:const TextStyle(color:N11Colors.ink2,fontSize:13))),
  ]);
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner:false,theme:buildN11Theme(),home:Scaffold(
    backgroundColor:Colors.white,body:SafeArea(bottom:false,child:Column(children:[
      Expanded(child:IndexedStack(index:selected,children:[
        widget.isFood?_foodHome():_shipHome(),
        for(var i=1;i<tabs.length;i++)_other(tabs[i].$1,tabs[i].$2),
      ])),
      _bottom(),
    ]))),
  );
}
class _PreviewMapPainter extends CustomPainter {
  @override
  void paint(Canvas canvas,Size size) {
    final bg=Paint()..color=const Color(0xFFEAF1E9);
    canvas.drawRect(Offset.zero & size,bg);
    final street=Paint()..color=Colors.white..strokeWidth=3.5..strokeCap=StrokeCap.round;
    for(var i=0;i<9;i++) {
      final y=(i+0.4)*size.height/9;
      canvas.drawLine(Offset(0,y+12*(i%3)),Offset(size.width,y-18*(i%4)),street);
    }
    for(var i=0;i<10;i++) {
      final x=(i+.3)*size.width/10;
      canvas.drawLine(Offset(x-9,0),Offset(x+29,size.height),street);
    }
    final river=Paint()..color=const Color(0xFFA4D9ED)..strokeWidth=9..style=PaintingStyle.stroke;
    final path=Path()..moveTo(-5,size.height*.88)..cubicTo(size.width*.33,size.height*.5,
        size.width*.54,size.height*1.1,size.width+10,size.height*.44);
    canvas.drawPath(path,river);
    final center=Offset(size.width*.51,size.height*.51);
    canvas.drawCircle(center,65,Paint()..color=const Color(0x70FFC400));
    canvas.drawCircle(center,9,Paint()..color=Colors.white);
    canvas.drawCircle(center,6,Paint()..color=const Color(0xFF1976D2));
  }
  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate)=>false;
}