import asyncio
import ast
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('consumption', Path(__file__).parents[1] / 'open_webui/utils/consumption.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class FakeRedis:
    def __init__(self): self.data = {}
    async def get(self, key): return self.data.get(key)
    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data: return False
        self.data[key] = value
        return True
    async def eval(self, script, count, key, owner):
        if self.data.get(key) == owner: self.data.pop(key)

class ConsumptionTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_titles_run_once_and_users_are_separate(self):
        redis = FakeRedis(); calls = []
        async def generate():
            calls.append(1); await asyncio.sleep(0.01)
            return {'choices': [{'message': {'content': 'title'}}]}
        await asyncio.gather(*(m.title_once(redis, 'a', 'chat', generate) for _ in range(10)))
        result = await m.title_once(redis, 'a', 'chat', generate)
        self.assertEqual(len(calls), 1); self.assertTrue(result.get('choices'))
        await m.title_once(redis, 'b', 'chat', generate)
        self.assertEqual(len(calls), 2)
    async def test_failure_does_not_cache_and_releases_lock(self):
        redis = FakeRedis()
        async def fail(): raise ValueError('synthetic')
        with self.assertRaises(ValueError): await m.title_once(redis, 'a', 'chat', fail)
        self.assertFalse(redis.data)
        self.assertIsNone(await m.title_once(None, 'a', 'chat', fail))
    def test_short_titles_and_real_sessions(self):
        self.assertEqual(m.title_messages([{'role': 'system', 'content': 'secret'}, {'role': 'user', 'content': 'x' * 9999}, {'role': 'assistant', 'content': 'y' * 9999}]), [{'role': 'user', 'content': 'x' * 1200}])
        self.assertEqual(m.conversation_headers('https://ai.kividas.com/api/v1', 'https://ai.kividas.com/api/v1', {'chat_id': 'real-conversation'}), {'session_id': 'real-conversation'})
        for chat in (None, '', 'x\nheader', 'x' * 257): self.assertEqual(m.conversation_headers('https://ai.kividas.com', 'https://ai.kividas.com', {'chat_id': chat}), {})
        self.assertEqual(m.conversation_headers('https://other.example', 'https://ai.kividas.com', {'chat_id': 'real'}), {})

class ResponsesConversionTests(unittest.TestCase):
    def test_instructions_are_not_overwritten_or_moved_before_history(self):
        source = Path(__file__).parents[1] / 'open_webui/routers/openai.py'
        tree = ast.parse(source.read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'convert_to_responses_payload')
        scope = {'_normalize_stored_item': lambda item: item}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
        convert = scope['convert_to_responses_payload']
        history = [{'role': 'system', 'content': 'policy'}, {'role': 'developer', 'content': 'project'}, {'role': 'user', 'content': 'read'}, {'role': 'assistant', 'content': 'OK'}]
        first = convert({'model': 'gpt-5.6-sol', 'messages': copy.deepcopy(history + [{'role': 'system', 'content': 'budget 100'}])})
        second = convert({'model': 'gpt-5.6-sol', 'messages': copy.deepcopy(history + [{'role': 'system', 'content': 'budget 90'}])})
        self.assertEqual(first['instructions'], 'policy\n\nproject')
        self.assertEqual(first['instructions'], second['instructions'])
        self.assertEqual(first['input'][:-1], second['input'][:-1])
        self.assertEqual(first['input'][-1]['role'], 'developer')

if __name__ == '__main__': unittest.main()
