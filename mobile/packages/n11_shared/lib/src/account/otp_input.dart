import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens.dart';

/// One accessible/autofillable input, drawn as six cells. Paste and SMS autofill
/// remain a single edit; no separate focus or backspace rules for each digit.
class RegistrationOtpInput extends StatefulWidget {
  const RegistrationOtpInput({super.key, required this.controller, required this.enabled, required this.onChanged});

  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onChanged;

  @override
  State<RegistrationOtpInput> createState() => _RegistrationOtpInputState();
}

class _RegistrationOtpInputState extends State<RegistrationOtpInput> {
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _focus.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String code = widget.controller.text;
    final double height = MediaQuery.textScalerOf(context).scale(20) + 28;
    return SizedBox(
      height: height < 56 ? 56 : height,
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          ExcludeSemantics(
            child: Row(
              textDirection: TextDirection.ltr,
              children: <Widget>[
                for (int i = 0; i < 6; i++)
                  Expanded(
                    child: Container(
                      margin: EdgeInsets.only(right: i == 5 ? 0 : 6),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: N11Colors.white,
                        border: Border.all(color: _focus.hasFocus && i == (code.length < 6 ? code.length : 5) ? N11Colors.yellowStrong : N11Colors.line),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(i < code.length ? code[i] : '', style: N11Text.h2),
                    ),
                  ),
              ],
            ),
          ),
          Semantics(
            label: 'Mã OTP gồm 6 chữ số',
            child: TextField(
              key: const Key('otp-code'),
              controller: widget.controller,
              focusNode: _focus,
              enabled: widget.enabled,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              textInputAction: TextInputAction.done,
              autofillHints: const <String>[AutofillHints.oneTimeCode],
              inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
              enableSuggestions: false,
              autocorrect: false,
              showCursor: false,
              style: const TextStyle(color: Colors.transparent),
              decoration: const InputDecoration(border: InputBorder.none, enabledBorder: InputBorder.none, focusedBorder: InputBorder.none, disabledBorder: InputBorder.none),
              onChanged: (String value) {
                setState(() {});
                widget.onChanged();
              },
            ),
          ),
        ],
      ),
    );
  }
}
