FROM public.ecr.aws/lambda/python:3.11

# 依存関係をインストール
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Lambda関数コードをコピー
COPY __init__.py ${LAMBDA_TASK_ROOT}/

# ハンドラーを設定
CMD ["__init__.handler"]
