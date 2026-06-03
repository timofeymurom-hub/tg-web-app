"""
CyberBar ⚡️ — Flask Web App
Синхронизировано с Telegram-ботом через общий файл data.json
"""
import csv
import io
from datetime import datetime

from flask import Flask, render_template, jsonify, request, Response

import database as db

app = Flask(__name__)


# ─── СТРАНИЦЫ ────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


# ─── API: ДАШБОРД ───────────────────────────────
@app.route("/api/dashboard")
def api_dashboard():
    guests = db.get_all_guests()
    menu = db.get_menu()
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()
    now_ts = now.timestamp()

    today_sales = 0
    month_sales = 0
    debtors = 0
    total_debt = 0

    for g in guests:
        if g["balance"] > 0:
            debtors += 1
            total_debt += g["balance"]
        for o in g.get("orders", []):
            ts = o.get("timestamp", 0)
            if today_start <= ts <= now_ts:
                today_sales += o.get("total", 0)
            if month_start <= ts <= now_ts:
                month_sales += o.get("total", 0)

    return jsonify({
        "clients": len(guests),
        "menu_items": len(menu),
        "today_sales": today_sales,
        "month_sales": month_sales,
        "debtors": debtors,
        "total_debt": total_debt,
    })


# ─── API: КЛИЕНТЫ ───────────────────────────────
@app.route("/api/guests")
def api_guests():
    return jsonify(db.get_all_guests())


@app.route("/api/guests", methods=["POST"])
def api_add_guest():
    data = request.get_json(force=True)
    nick = data.get("nick", "").strip()
    if not nick or len(nick) > 30:
        return jsonify({"error": "Ник от 1 до 30 символов"}), 400
    if db.find_guest(nick):
        return jsonify({"error": "Клиент с таким именем уже есть"}), 400
    guest = db.create_guest(nick)
    return jsonify(guest)


@app.route("/api/guests/<guest_id>", methods=["DELETE"])
def api_delete_guest(guest_id):
    g = db.delete_guest(guest_id)
    if g:
        return jsonify({"ok": True})
    return jsonify({"error": "Клиент не найден"}), 404


@app.route("/api/guests/<guest_id>/clear", methods=["POST"])
def api_clear_debt(guest_id):
    g = db.clear_debt(guest_id)
    if g:
        return jsonify(g)
    return jsonify({"error": "Клиент не найден"}), 404


@app.route("/api/guests/<guest_id>/writeoff", methods=["POST"])
def api_writeoff(guest_id):
    data = request.get_json(force=True)
    amount = int(data.get("amount", 0))
    if amount <= 0:
        return jsonify({"error": "Сумма должна быть положительной"}), 400
    g = db.writeoff_debt(guest_id, amount)
    if g:
        return jsonify(g)
    return jsonify({"error": "Клиент не найден"}), 404


@app.route("/api/guests/<guest_id>/orders/<float:timestamp>", methods=["DELETE"])
def api_delete_order(guest_id, timestamp):
    g = db.remove_order(guest_id, timestamp)
    if g:
        return jsonify(g)
    return jsonify({"error": "Покупка не найдена"}), 404


# ─── API: МЕНЮ ──────────────────────────────────
@app.route("/api/menu")
def api_menu():
    return jsonify(db.get_menu())


@app.route("/api/menu", methods=["POST"])
def api_add_menu():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    price = int(data.get("price", 0))
    if not name:
        return jsonify({"error": "Введите название"}), 400
    if price <= 0:
        return jsonify({"error": "Цена должна быть положительной"}), 400
    item = db.add_menu_item(name, price)
    return jsonify(item)


@app.route("/api/menu/<int:item_id>", methods=["PUT"])
def api_update_menu(item_id):
    data = request.get_json(force=True)
    price = int(data.get("price", 0))
    if price <= 0:
        return jsonify({"error": "Цена должна быть положительной"}), 400
    item = db.update_menu_item(item_id, price)
    if item:
        return jsonify(item)
    return jsonify({"error": "Товар не найден"}), 404


@app.route("/api/menu/<int:item_id>", methods=["DELETE"])
def api_delete_menu(item_id):
    item = db.remove_menu_item(item_id)
    if item:
        return jsonify({"ok": True})
    return jsonify({"error": "Товар не найден"}), 404


# ─── API: ЗАПИСЬ ПРОДАЖИ ────────────────────────
@app.route("/api/record", methods=["POST"])
def api_record():
    data = request.get_json(force=True)
    guest_id = data.get("guest_id", "")
    item_id = int(data.get("item_id", 0))
    qty = int(data.get("qty", 0))
    if qty <= 0:
        return jsonify({"error": "Количество должно быть положительным"}), 400
    item = db.get_menu_item_by_id(item_id)
    if not item:
        return jsonify({"error": "Товар не найден"}), 404
    guest = db.find_guest(guest_id)
    if not guest:
        return jsonify({"error": "Клиент не найден"}), 404
    g = db.add_order(guest_id, item, qty)
    return jsonify(g)


# ─── API: ОТЧЁТЫ ────────────────────────────────
@app.route("/api/report/stats")
def api_report_stats():
    start = float(request.args.get("start", 0))
    end = float(request.args.get("end", 9999999999))
    guests = db.get_all_guests()
    rows = []
    total = 0
    for g in guests:
        for o in g.get("orders", []):
            ts = o.get("timestamp", 0)
            if start <= ts <= end:
                rows.append({
                    "nick": g["nick"],
                    "item": o["item"],
                    "quantity": o["quantity"],
                    "price": o["price"],
                    "total": o["total"],
                    "date": o["date"],
                })
                total += o["total"]
    return jsonify({"rows": rows, "total": total})


@app.route("/api/report/csv")
def api_report_csv():
    start = float(request.args.get("start", 0))
    end = float(request.args.get("end", 9999999999))
    guests = db.get_all_guests()
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=';')
    writer.writerow(["Клиент", "Товар", "Кол-во", "Цена", "Сумма", "Дата", "Долг клиента"])

    report_data = []
    total = 0
    for g in guests:
        client_orders = []
        gs = 0
        for o in g.get("orders", []):
            ts = o.get("timestamp", 0)
            if start <= ts <= end:
                gs += o.get("total", 0)
                client_orders.append(o)
        if gs > 0:
            report_data.append((g["nick"], client_orders, gs, g["balance"]))
            total += gs

    for nick, orders, subtotal, balance in report_data:
        for i, o in enumerate(orders):
            writer.writerow([
                nick,
                o["item"],
                o["quantity"],
                f"{o['price']} ₸",
                f"{o['total']} ₸",
                o["date"],
                f"{balance} ₸" if i == 0 else ""
            ])
        writer.writerow(["", "", "", f"Итого {nick}:", f"{subtotal} ₸", "", ""])
        writer.writerow([])

    writer.writerow(["", "", "", "ОБЩИЙ ИТОГО:", f"{total} ₸", "", ""])

    return Response(
        buf.getvalue().encode("utf-8-sig"),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=report.csv"},
    )
